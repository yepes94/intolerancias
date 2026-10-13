// Intolerancias · tests/diet.test.mjs — node tests/diet.test.mjs
// Sin dependencias: carga los js/ reales en un sandbox y la Function con fetch simulado.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (extra ? " → " + extra : "")); }
}

// ---------- 1. Lógica cliente (js/data.js + js/diet.js) ----------
console.log("1. js/diet.js (señales, plan local, conflictos, comparación)");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of ["js/data.js", "js/diet.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox);
const Diet = sandbox.window.IntolDiet;

let t = 1000;
const meal = (id, desc, ings, comps, dietId) => ({
  id, createdAt: t++, description: desc, ingredients: ings.map((i) => ({ id: i, source: "local" })),
  analysis: comps ? { components: comps } : null, ...(dietId ? { dietId } : {})
});
const ck = (mealId, feeling, symptoms, extra) => ({ id: "c" + t++, mealId, doneAt: t++, feeling, symptoms, ...(extra || {}) });

{
  const meals = [
    meal("m1", "bocadillo de jamón", ["gluten", "histamina"]),
    meal("m2", "pasta boloñesa", ["gluten"]),
    meal("m3", "pan blanco de molde", [], ["gluten", "trigo", "fructanos"]),
    meal("m4", "ensalada con pollo", []),
    meal("m5", "arroz con verduras", [])
  ];
  const checkins = [
    ck("m1", 2, ["hinchazón"]), ck("m2", 3, ["pesadez"]), ck("m3", 2, ["cansancio"]),
    ck("m4", 4, []), ck("m5", 5, [])
  ];
  const sig = Diet.buildSignals(meals, checkins);
  ok(sig.avoid.includes("gluten"), "gluten + hinchazón/pesadez/cansancio → se excluye gluten", JSON.stringify(sig.avoid));
  ok(!sig.avoid.includes("histamina"), "histamina con 1 sola comida → no se excluye");
  ok(sig.suspects[0].n === 3 && sig.suspects[0].bad === 3, "componentes del análisis IA guardado cuentan (m3 sin pastilla gluten)");
  ok(sig.recent.length === 5 && sig.recent[0].d === "bocadillo de jamón", "recent resume comidas registradas");
  ok(sig.baseline === 3.2, "baseline = media de check-ins", String(sig.baseline));

  const plan = Diet.localPlan("day", "", sig.avoid);
  ok(plan.meals.map((m) => m.slot).join() === "desayuno,comida,merienda,cena", "plan local día completo: 4 franjas en orden");
  ok(Object.keys(Diet.conflicts(plan, sig.avoid)).length === 0, "plan local sin gluten no menciona gluten", JSON.stringify(Diet.conflicts(plan, sig.avoid)));
  ok(plan.mode === "exclusion" && /gluten/.test(plan.rationale), "plan local explica la exclusión");
}
{
  const sig = Diet.buildSignals([meal("a", "ensalada", []), meal("b", "pollo", [])], [ck("a", 4, []), ck("b", 4, [])]);
  ok(sig.avoid.length === 0, "sin señales → nada que excluir");
  const plan = Diet.localPlan("meal", "cena", sig.avoid);
  ok(plan.mode === "equilibrada" && plan.meals.length === 1 && plan.meals[0].slot === "cena", "sin señales → una comida equilibrada (cena)");
}
{
  const ex = ["lactosa", "gluten", "huevo", "frutosSecos", "cafeina"];
  const plan = Diet.localPlan("day", "", ex);
  ok(Object.keys(Diet.conflicts(plan, ex)).length === 0, "plan local respeta 5 exclusiones a la vez");
  const ai = { meals: [{ slot: "comida", name: "Pasta con queso", items: ["pasta", "queso"] }, { slot: "cena", name: "Pollo con pan sin gluten", items: ["pan sin gluten"] }] };
  const c = Diet.conflicts(ai, ["gluten", "lactosa"]);
  ok(c.comida && c.comida.includes("gluten") && c.comida.includes("lactosa"), "conflicto: plato IA con pasta+queso se marca");
  ok(!c.cena, "«pan sin gluten» no cuenta como gluten");
  ok(Diet.keysInText("yogur sin lactosa con pan").join() === "gluten", "«sin X» solo niega su tramo (yogur sin lactosa con pan → gluten)");
  ok(Diet.keysInText("aceite de oliva").length === 0, "«aceite» ya no se confunde con té/cafeína");
}
{
  const plan = { id: "p1" };
  const meals = [meal("d1", "Comida (dieta)", [], null, "p1"), meal("n1", "pizza", ["gluten"])];
  const checkins = [ck("d1", 4, []), ck(null, 5, [], { dietId: "p1" }), ck("n1", 2, ["hinchazón"]), ck("n1", 1, ["hinchazón", "gases"])];
  const c = Diet.compare(plan, meals, checkins);
  ok(c.with.n === 2 && c.with.avg === 4.5 && c.with.targetRate === 0, "comparación: check-ins enlazados (por comida y por dietId)");
  ok(c.without.n === 2 && c.without.avg === 1.5 && c.without.targetRate === 1, "comparación: resto de check-ins sin plan");
}
{
  const plan = Diet.localPlan("day", "", []);
  ok(plan.meals.every((m) => /^\d\d:\d\d$/.test(m.time) && m.steps.length >= 2 && m.swap && m.watch && m.items.some((x) => /\d/.test(x))),
    "plan local explicado: hora, cantidades, pasos, alternativa y qué observar en cada comida");
  const shop = Diet.shoppingList({ meals: [{ items: ["1 plátano", "150 g de merluza", "1 cucharada de aceite de oliva"] }, { items: ["1 plátano", "aceite de oliva", "1 cucharada de aceite de oliva"] }] });
  const by = Object.fromEntries(shop.map((x) => [x.name, x.qty.join(" + ")]));
  ok(shop.length === 3 && by["plátano"] === "1 + 1" && by["merluza"] === "150 g" && by["aceite de oliva"] === "1 cucharada + 1 cucharada",
    "lista de la compra: agrupa por ingrediente y suma cantidades", JSON.stringify(shop));
  const txt = Diet.planText(plan);
  ok(/DESAYUNO · 08:00/.test(txt) && /Qué observar:/.test(txt) && /1\. /.test(txt) && txt.endsWith(Diet.DISCLAIMER), "texto para compartir: horas, pasos, qué observar y aviso al final");
  const old = Diet.planText({ meals: [{ slot: "cena", name: "Pavo", items: ["pavo"], why: "ligero" }] });
  ok(/CENA — Pavo/.test(old), "planes antiguos sin campos nuevos siguen funcionando");
}
ok(/m[ée]dico/.test(Diet.DISCLAIMER) && /nutricionista/.test(Diet.DISCLAIMER) && /pruebas de intolerancia/.test(Diet.DISCLAIMER), "disclaimer: médico + nutricionista + pruebas de intolerancia");

// ---------- 2. Function /api/diet con upstream simulado ----------
console.log("2. functions/api/diet.js (validación, taxonomía, JSON conciso, privacidad)");
const { onRequest } = await import(pathToFileURL(path.join(root, "functions/api/diet.js")).href);
const KEY = "fake-claude-key-not-real-0000";
let lastUpstream = null;
let upstream = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => { lastUpstream = { url, init, body: init && init.body ? JSON.parse(init.body) : null }; return upstream(url, init); };
const call = async (method, body) => {
  const req = new Request("https://x/api/diet", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await onRequest({ request: req });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null, cc: res.headers.get("cache-control") };
};
const claudeText = (text, stop) => () => new Response(JSON.stringify({
  content: [{ type: "text", text }], stop_reason: stop || "end_turn", usage: { input_tokens: 400, output_tokens: 420 }
}), { status: 200, headers: { "content-type": "application/json" } });
const ctx = { avoid: ["gluten"], suspects: [{ id: "gluten", n: 3, bad: 3, symptoms: ["hinchazón"] }], recent: [{ d: "pasta", ings: ["gluten"], comps: [], f: 2, s: ["hinchazón"] }], baseline: 3 };

{
  const r = await call("GET");
  ok(r.status === 200 && r.json.service === "diet-proxy" && r.cc === "no-store", "GET salud 200 + no-store");
  ok((await call("POST", { provider: "claude", scope: "day" })).json.kind === "auth", "sin key → 401 auth");
  const h = await call("POST", { provider: "hermes", key: KEY, scope: "day" });
  ok(h.status === 501 && h.json.kind === "notimpl" && !h.text.includes(KEY), "hermes → 501 notimpl sin eco de key");
  ok((await call("POST", { provider: "xxx", key: KEY })).status === 400, "proveedor desconocido → 400");
  ok((await call("POST", { provider: "claude", key: KEY, scope: "week" })).json.kind === "badrequest", "scope inválido → 400 badrequest");
  ok((await call("POST", { provider: "claude", key: KEY, scope: "meal" })).json.kind === "badrequest", "una comida sin slot → 400 badrequest");
}
{
  const plan = {
    mode: "exclusion", avoid: [], rationale: "Sin gluten por tus molestias.",
    meals: [
      { slot: "desayuno", time: "8:00", name: "Copos de arroz con plátano", items: ["40 g de copos de arroz", "1 plátano", "200 ml de bebida de arroz", "canela", "miel", "extra1", "extra2"], why: "Ligero",
        steps: ["Calienta la bebida.", "Añade los copos y el plátano."], swap: "Copos de mijo", watch: "Si notas hinchazón a media mañana." },
      { slot: "Almuerzo", time: "25:99", name: "Merluza con patata", items: ["merluza", "patata"], why: "x".repeat(400) },
      { slot: "merienda", name: "Tortitas de arroz", items: ["tortitas"], why: "" },
      { slot: "cena", name: "Pavo con verduras", items: ["pavo"], why: "" }
    ],
    tips: ["a", "b", "c", "d", "e"]
  };
  upstream = claudeText("Aquí tienes:\n```json\n" + JSON.stringify(plan) + "\n```");
  const r = await call("POST", { provider: "claude", key: KEY, scope: "day", context: ctx });
  ok(r.status === 200 && r.json.ok && r.json.result.meals.length === 4, "Claude día completo con fences → 200 con 4 comidas", r.text.slice(0, 200));
  ok(r.json.result.meals[1].slot === "comida", "«Almuerzo» se normaliza a comida");
  ok(r.json.result.avoid.includes("gluten"), "la IA no puede quitar exclusiones del cliente (gluten se mantiene)");
  ok(r.json.result.meals[0].items.length === 7 && r.json.result.meals[1].why.length === 400 && r.json.result.tips.length === 5, "sin recortes de contenido razonable: 7 items, why de 400, 5 tips");
  const d0 = r.json.result.meals[0];
  ok(d0.time === "08:00" && d0.steps.length === 2 && /mijo/.test(d0.swap) && /hinchazón/.test(d0.watch), "se conservan hora, pasos, alternativa y qué observar", JSON.stringify(d0));
  ok(!("time" in r.json.result.meals[1]) && r.json.result.meals[1].steps.length === 0, "hora inválida se descarta; sin pasos → lista vacía");
  ok(lastUpstream.body.max_tokens === 128000 && lastUpstream.init.headers["x-api-key"] === KEY, "upstream Claude: max_tokens = máximo del modelo (128000), key solo en cabecera");
  const prompt = lastUpstream.body.messages[0].content;
  ok(/EXCLUYE.*gluten/.test(prompt) && /energia y poca pesadez/.test(prompt) && /pasta/.test(prompt), "prompt: excluye gluten, prioriza energía/poca pesadez, usa comidas registradas");
  ok(!r.text.includes(KEY), "respuesta sin eco de la key");
  ok(prompt.length < 3000, "prompt acotado (" + prompt.length + " caracteres)");
}
{
  upstream = claudeText(JSON.stringify({ meals: [{ slot: "cena", name: "Pavo", items: ["pavo"] }] }));
  const r = await call("POST", { provider: "claude", key: KEY, scope: "meal", slot: "cena", context: { avoid: [], suspects: [], recent: [] } });
  ok(r.status === 200 && r.json.result.mode === "equilibrada" && r.json.result.meals.length === 1, "una comida sin señales → equilibrada");
  ok(lastUpstream.body.max_tokens === 128000 && /equilibrada y ligera/.test(lastUpstream.body.messages[0].content), "una comida: sin tope propio (128000) + prompt equilibrada y ligera");
  ok(/cantidades/.test(lastUpstream.body.messages[0].content) && /"steps"/.test(lastUpstream.body.messages[0].content) && /"watch"/.test(lastUpstream.body.messages[0].content), "prompt pide cantidades, pasos y qué observar");
}
{
  const huge = { meals: [{ slot: "cena", name: "Pavo", items: Array.from({ length: 30 }, (_, i) => "item " + i), steps: Array.from({ length: 20 }, () => "y".repeat(900)) }], tips: Array.from({ length: 20 }, () => "t") };
  upstream = claudeText(JSON.stringify(huge));
  const r = await call("POST", { provider: "claude", key: KEY, scope: "meal", slot: "cena", context: ctx });
  const m = r.json.result.meals[0];
  ok(m.items.length === 12 && m.steps.length === 8 && m.steps[0].length <= 300 && r.json.result.tips.length === 6, "saneado anti-desbordes: 12 items, 8 pasos ≤300, 6 tips");
}
{
  upstream = claudeText("", "max_tokens");
  const r = await call("POST", { provider: "claude", key: KEY, scope: "day", context: ctx });
  ok(r.json.kind === "badjson" && /stop=max_tokens/.test(r.json.message) && /Se cortó/.test(r.json.message), "vacío por max_tokens → badjson con diagnóstico y aviso de corte");
  upstream = claudeText("Lo siento, no puedo.");
  ok((await call("POST", { provider: "claude", key: KEY, scope: "day", context: ctx })).json.kind === "badjson", "prosa sin JSON → badjson");
  upstream = () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  ok((await call("POST", { provider: "claude", key: KEY, scope: "day" })).json.kind === "badjson", "200 no-JSON → badjson");
  upstream = () => new Response('{"error":"invalid x-api-key"}', { status: 401 });
  const a = await call("POST", { provider: "claude", key: KEY, scope: "day" });
  ok(a.status === 401 && a.json.kind === "auth" && !a.text.includes(KEY), "401 del proveedor → auth sin eco de key");
  upstream = () => new Response("slow down", { status: 429 });
  ok((await call("POST", { provider: "groq", key: "gsk_x", scope: "day" })).json.kind === "ratelimit", "429 → ratelimit");
  upstream = () => { throw new TypeError("fetch failed"); };
  ok((await call("POST", { provider: "groq", key: "gsk_x", scope: "day" })).json.kind === "network", "fallo de red → network");
  upstream = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ meals: [{ slot: "comida", name: "Arroz con pollo", items: [] }] }) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const g = await call("POST", { provider: "groq", key: "gsk_x", scope: "meal", slot: "comida" });
  ok(g.status === 200 && lastUpstream.body.response_format.type === "json_object" && lastUpstream.init.headers.authorization === "Bearer gsk_x", "Groq una comida → 200, json_object, Bearer");
}
{
  const src = readFileSync(path.join(root, "functions/api/diet.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/console\.(log|info|warn|error|debug)/.test(code), "la Function no escribe logs");
  ok(!/(KV|D1|env\.)/.test(code), "la Function no persiste nada (sin KV/D1/env)");
}

// ---------- 3. Cliente js/providers.js → /api/diet ----------
console.log("3. js/providers.js planDiet");
{
  const calls = [];
  const sb = { window: {}, console, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return respond(); } };
  let respond = () => new Response(JSON.stringify({ ok: true, result: { meals: [{ slot: "comida", name: "x" }] } }), { status: 200 });
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/providers.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const P = sb.window.IntolProviders;
  const out = await P.registry.claude.planDiet({ scope: "meal", slot: "comida", context: ctx }, KEY, "", {});
  ok(calls[0].url === "/api/diet" && calls[0].body.scope === "meal" && calls[0].body.context.avoid[0] === "gluten" && !("imageDataUrl" in calls[0].body), "Claude planDiet → POST /api/diet con contexto, sin foto");
  ok(out.meals.length === 1, "resultado del proxy llega intacto");
  respond = () => new Response(JSON.stringify({ ok: false, kind: "auth", message: "Claude rechazó la clave" }), { status: 401 });
  let kind = null;
  try { await P.registry.groq.planDiet({ scope: "day" }, "gsk_x", "", {}); } catch (e) { kind = e.kind; }
  ok(kind === "auth", "error del proxy conserva kind (auth)");
  respond = () => new Response(JSON.stringify({ ok: true, result: { meals: [] } }), { status: 200 });
  try { await P.registry.claude.planDiet({ scope: "day" }, KEY, "", {}); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "badjson", "plan vacío → badjson");
  try { await P.registry.hermes.planDiet(); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "notimpl", "Hermes planDiet → notimpl");
  sb.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try { await P.registry.claude.planDiet({ scope: "day" }, KEY, "", {}); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "network", "sin proxy (python http.server/file://) → network");
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
