// Intolerancias · tests/drinks.test.mjs — node tests/drinks.test.mjs
// Sin dependencias: carga js/data.js + js/features/drinks.js en un sandbox
// y comprueba catálogo, hidratación, store e integración con diario/dieta.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (extra ? " → " + extra : "")); }
}

const H = 3600e3;
const sandbox = { window: {}, console, Date };
vm.createContext(sandbox);
for (const f of ["js/data.js", "js/diet.js", "js/diary.js", "js/features/drinks.js"])
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox);
const Drinks = sandbox.window.IntolDrinks;
const Diary = sandbox.window.IntolDiary;
const Diet = sandbox.window.IntolDiet;
const Data = sandbox.window.IntolData;

const NOW = new Date(2026, 9, 14, 12, 0).getTime();

console.log("1. Catálogo: botones rápidos y mapeo a componentes");
{
  ok(Drinks.TYPES.length === 11, "11 botones rápidos (agua, café, té, leche, vegetal, refresco, zumo, cerveza, vino, destilado, otra)");
  const keys = Object.keys(Data.ONSET_WINDOWS);
  const bad = Drinks.TYPES.filter((t) => t.components.some((c) => !keys.includes(c)));
  ok(!bad.length, "todos los componentes existen en ONSET_WINDOWS");
  const comp = (id) => Drinks.typeById(id).components.join();
  ok(comp("agua") === "" && comp("otra") === "", "agua y otra no aportan componentes");
  ok(comp("cafe") === "cafeina" && comp("te") === "cafeina", "café y té → cafeína");
  ok(comp("leche") === "lactosa" && comp("vegetal") === "soja", "leche → lactosa; vegetal → soja");
  ok(comp("refresco") === "fructosa" && comp("zumo") === "fructosa", "refresco y zumo → fructosa");
  ok(comp("cerveza") === "alcohol,gluten", "cerveza → alcohol + gluten");
  ok(comp("vino") === "alcohol,histamina" && comp("destilado") === "alcohol", "vino → alcohol + histamina; destilado → alcohol");
  ok(Drinks.sizeById("vaso").ml === 250 && Drinks.sizeById("taza").ml === 200 && Drinks.sizeById("ml").ml == null,
    "cantidades: vaso 250 ml, taza 200 ml o ml libres");
}

console.log("2. makeDrink: forma de ingesta (cruce con comidas)");
{
  const c = Drinks.makeDrink({ type: "cafe", sizeId: "taza", at: NOW - 2 * H });
  ok(c.kind === "drink" && c.ml === 200 && c.createdAt === NOW - 2 * H, "café en taza → 200 ml con hora ajustable");
  ok(c.description === "Café · taza (200 ml)", "descripción legible", c.description);
  ok(c.ingredients.length === 1 && c.ingredients[0].id === "cafeina" && c.ingredients[0].source === "drink",
    "ingredientes con source drink");
  const b = Drinks.makeDrink({ type: "cerveza", sizeId: "ml", ml: 330, at: NOW - H });
  ok(b.ml === 330 && b.description === "Cerveza · 330 ml" && b.ingredients.length === 2, "ml libres: cerveza 330 ml", b.description);
  const clip = Drinks.makeDrink({ type: "agua", sizeId: "ml", ml: 5000, at: NOW });
  ok(clip.ml === 2000, "ml recortados a 20–2000");
  const def = Drinks.makeDrink({ type: "inventado", at: NOW });
  ok(def.type === "otra", "tipo desconocido → otra");
}

console.log("3. Hidratación: solo el agua cuenta, objetivo configurable");
{
  const drinks = [
    Drinks.makeDrink({ type: "agua", sizeId: "vaso", at: NOW - 3 * H }),
    Drinks.makeDrink({ type: "agua", sizeId: "vaso", at: NOW - H }),
    Drinks.makeDrink({ type: "cafe", sizeId: "taza", at: NOW - H }),
    Drinks.makeDrink({ type: "agua", sizeId: "vaso", at: NOW - 30 * H })
  ];
  ok(Drinks.waterMl(drinks, NOW) === 500, "2 vasos de hoy = 500 ml (café y ayer no cuentan)");
  const h = Drinks.hydration(drinks, 2000, NOW);
  ok(h.ml === 500 && h.goal === 2000 && h.pct === 25 && h.remaining === 1500, "hidratación 500/2000 = 25 %");
  ok(Drinks.hydration(drinks, "loco", NOW).goal === 2000, "objetivo inválido → 2000");
  ok(Drinks.sanitizeGoal(1500) === 1500 && Drinks.sanitizeGoal(100) === 2000, "objetivo 250–5000, resto → 2000");
  const day = Drinks.componentsOnDay(drinks, NOW);
  ok(day.cafeina && day.cafeina.n === 1 && !day.lactosa, "componentes del día: cafeína ×1");
}

console.log("4. Diario: las bebidas alimentan /api/diary y el análisis local");
{
  const meals = [{ id: "m1", createdAt: NOW - 8 * H, description: "ensalada", feeling0: 3, ingredients: [] }];
  const drinks = [Drinks.makeDrink({ type: "cafe", sizeId: "taza", at: NOW - 1.5 * H })];
  const all = meals.concat(drinks);
  const w = Diary.windowMeals(all, NOW);
  ok(w.length === 2 && w[0].kind === "drink", "ventana 24 h incluye la bebida, la más cercana primero");
  const e = { id: "e1", at: NOW, text: "dolor de cabeza y acidez", level: 2, symptoms: Diary.extractSymptoms("dolor de cabeza y acidez") };
  const loc = Diary.localAnalyze(e, all, []);
  const cof = loc.causes.find((c) => String(c.mealId).startsWith("drink-"));
  ok(cof && cof.ingredients.includes("cafeina"), "análisis local: el café encaja con dolor de cabeza/acidez", JSON.stringify(cof));
  const { body } = Diary.payload(e, all, []);
  const sent = body.meals.find((m) => /Café/.test(m.d));
  ok(sent && sent.ings.includes("cafeina"), "payload a /api/diary lleva la bebida con sus componentes");
}

console.log("5. Dieta: las bebidas generan señales de exclusión");
{
  const mk = (id, h, type) => Drinks.makeDrink({ type, sizeId: "taza", at: NOW - h * H });
  const all = [mk("a", 30, "cafe"), mk("b", 54, "cafe"), { id: "m3", createdAt: NOW - 78 * H, description: "arroz", ingredients: [] }];
  const entries = [0, 1].map((i) => ({
    id: "x" + i, at: all[i].createdAt + 2 * H, text: "dolor de cabeza", level: 2,
    symptoms: ["dolor de cabeza"]
  })).concat([{ id: "y", at: NOW - 76 * H, text: "bien", level: 5, symptoms: [] }]);
  const sig = Diet.buildSignals(all, Diary.feelings(all, entries));
  ok(sig.avoid.includes("cafeina"), "2 cafés con malestar → se excluye cafeína", JSON.stringify(sig.avoid));
}

console.log("6. Store: persiste, exporta y se borra con «Borrar todo»");
{
  const mem = { "intol.checkins.v1": "[]" };
  const sb = { window: {}, console, localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }, indexedDB: { deleteDatabase: () => ({}) } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/store.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const S = sb.window.IntolStore;
  ok(Array.isArray(S.getDrinks()) && S.getDrinks().length === 0, "sin bebidas → []");
  ok(S.getSettings().waterGoalMl === 2000, "objetivo de agua por defecto 2000 ml");
  S.saveDrinks([{ id: "d1" }]);
  ok(S.getDrinks().length === 1, "bebidas persisten en intol.drinks.v1");
  S.saveSettings({ ...S.getSettings(), waterGoalMl: 1500 });
  ok(S.getSettings().waterGoalMl === 1500, "objetivo configurable persiste");
  S.wipe();
  ok(!mem["intol.drinks.v1"], "Borrar todo limpia las bebidas");
}

console.log("7. Enganche al tile «Bebida» del Home (docs/diseno.md)");
{
  ok(Drinks.registerHomeTile(() => {}, () => []) === false, "sin IntolHome → false, sin romper");
  sandbox.window.IntolHome = { tiles: [], registerTile(t) { this.tiles.push(t); }, refresh() {} };
  const reg = Drinks.registerHomeTile(() => "abierto", () => [1, 2]);
  const tile = sandbox.window.IntolHome.tiles.find((t) => t.id === "bebida");
  ok(reg === true && tile && tile.emoji === "🥤" && typeof tile.onOpen === "function" && tile.records().length === 2,
    "con IntolHome → tile bebida con onOpen y records");
  delete sandbox.window.IntolHome;
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
