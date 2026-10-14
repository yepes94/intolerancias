// Intolerancias · tests/bowel.test.mjs — node tests/bowel.test.mjs
// Sin dependencias: carga los js/ reales en un sandbox y las Functions con fetch simulado.
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

const H = 3600e3;
const sandbox = { window: {}, console, Date, Math };
vm.createContext(sandbox);
for (const f of ["js/data.js", "js/diet.js", "js/features/bowel.js", "js/diary.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox);
const { IntolBowel: B, IntolDiary: Diary, IntolDiet: Diet } = sandbox.window;

const NOW = new Date(2026, 9, 13, 22, 0).getTime();
const meal = (id, hoursAgo, desc, ings) => ({
  id, createdAt: NOW - hoursAgo * H, description: desc, feeling0: 3,
  ingredients: (ings || []).map((i) => ({ id: i, source: "local" })), thumb: null
});
const stool = (id, hoursAgo, type, extra) => B.make({ id, at: NOW - hoursAgo * H, type, ...(extra || {}) });

console.log("1. js/features/bowel.js (escala de Bristol)");
{
  ok(B.TYPES.length === 7 && B.TYPES.every((t, i) => t.type === i + 1 && t.emoji && t.name && t.desc && B.CATS[t.cat]), "7 tipos con emoji, nombre, explicación y categoría");
  ok(B.TYPES.slice(0, 2).every((t) => t.cat === "constipation") && B.TYPES.slice(2, 4).every((t) => t.cat === "normal") &&
    B.TYPES[4].cat === "soft" && B.TYPES.slice(5).every((t) => t.cat === "diarrhea"), "1–2 estreñimiento · 3–4 normal · 5 blanda · 6–7 diarrea");
  ok(B.make({ type: 0 }) === null && B.make({ type: 8 }) === null && B.make({ type: "x" }) === null && B.make({ type: 3.5 }) === null, "tipos fuera de 1–7 se rechazan");
  const s = B.make({ type: "4", note: "  tras   el café ", pain: true, urgency: "sí", blood: false, at: NOW });
  ok(s.type === 4 && s.note === "tras el café" && s.pain === true && s.urgency === false && s.blood === false && s.id && s.createdAt, "make normaliza tipo, nota y marcas (solo true estricto)");
  ok(B.make({ type: 3, note: "x".repeat(900) }).note.length === 280, "nota acotada a 280");
  ok(B.make({ type: 3, at: Date.now() + 9e9 }).at <= Date.now() + 61e3, "no admite fechas en el futuro");
  const list = B.sanitizeList([{ type: 9 }, null, { type: 2, at: 1000 }, { type: 5, at: 2000 }]);
  ok(list.length === 2 && list[0].type === 5, "sanitizeList descarta basura y ordena por hora desc");
  ok(B.redFlag(stool("a", 1, 4, { blood: true })) && !B.redFlag(stool("b", 1, 4, { pain: true })), "solo la sangre dispara el aviso de consulta");
  ok(/consulta/i.test(B.BLOOD_ADVICE), "el aviso de sangre recomienda consultar");
  ok(B.symptomsOf(stool("c", 1, 7, { pain: true })).join() === "diarrea,dolor abdominal" && B.symptomsOf(stool("d", 1, 1)).join() === "estreñimiento" && B.symptomsOf(stool("e", 1, 4)).length === 0, "síntomas implicados: diarrea, estreñimiento, dolor");
  ok(B.isAbnormal(stool("f", 1, 6)) && B.isAbnormal(stool("g", 1, 4, { blood: true })) && !B.isAbnormal(stool("h", 1, 3)) && !B.isAbnormal(stool("i", 1, 5)), "anómala: 1-2, 6-7, dolor o sangre");
}
{
  const st = [stool("a", 2, 7, { urgency: true }), stool("b", 30, 4), stool("c", 10, 4, { note: "privado" }), stool("d", 60, 1)];
  ok(B.windowStools(st, NOW).map((s) => s.id).join() === "a,c", "ventana de 24 h anteriores, la más reciente primero");
  const p = B.payload(st, NOW);
  ok(p.length === 2 && p[0].type === 7 && p[0].h === 2 && p[0].urgency === true && !JSON.stringify(p).includes("privado") && !("id" in p[0]), "payload: tipo, horas y marcas; sin notas ni ids");
  const d = B.distribution(st.concat(stool("old", 24 * 40, 3)), NOW, 30);
  ok(d.total === 4 && d.counts.join() === "1,0,0,2,0,0,1" && d.top === 4 && d.byCat.normal === 2 && d.byCat.diarrhea === 1 && d.byCat.constipation === 1, "distribución 30 días por tipo y categoría", JSON.stringify(d));
  ok(B.contextPayload([], NOW) === null && B.contextPayload(st, NOW).counts.length === 7 && B.contextPayload(st, NOW).total === 4, "contexto de dieta: null sin datos; 7 contadores con datos");
}

console.log("2. Diario: localAnalyze, payload y señal para Resumen/Dieta");
{
  const meals = [meal("pizza", 3, "pizza con queso", ["lactosa", "gluten"])];
  const e = { id: "e1", at: NOW, createdAt: NOW, text: "No me encuentro bien", level: 3, symptoms: [] };
  const base = Diary.localAnalyze(e, meals, []);
  ok(!/Señal digestiva/.test(base.summary) && !base.urgent, "sin deposiciones el análisis local no cambia");
  const st = [stool("a", 1, 7, { urgency: true })];
  const loc = Diary.localAnalyze(e, meals, [], st);
  ok(/Señal digestiva: 1 deposición\(es\)/.test(loc.summary) && /Bristol 7/.test(loc.summary) && loc.causes.some((c) => c.mealId === "pizza"), "con diarrea reciente: línea de señal digestiva y la lactosa pasa a encajar", loc.summary + " " + JSON.stringify(loc.causes));
  ok(!loc.urgent, "diarrea sin sangre → no urgente");
  const bl = Diary.localAnalyze(e, meals, [], [stool("b", 1, 4, { blood: true })]);
  ok(bl.urgent && /consulta/i.test(bl.advice), "sangre → urgent y recomienda consulta");

  const { body } = Diary.payload(e, meals, [], st);
  ok(body.bowel.length === 1 && body.bowel[0].type === 7 && body.bowel[0].h === 1, "payload de /api/diary incluye deposiciones de 24 h");
  ok(!("bowel" in Diary.payload(e, meals, [], []).body) && !("bowel" in Diary.payload(e, meals, []).body), "sin deposiciones no se envía el campo");

  const recs = Diary.feelings(meals, [], [stool("a", 1, 7), stool("n", 1, 4)]);
  ok(recs.length === 1 && recs[0].mealId === "pizza" && recs[0].bowel && recs[0].symptoms.join() === "diarrea" && recs[0].feeling === 2, "feelings: solo las anómalas, enlazadas a las comidas previas");
}
{
  const meals = ["a", "b", "c"].map((id, i) => meal(id, 30 + i * 24, "bocadillo " + id, ["gluten"]))
    .concat(["d", "e"].map((id, i) => meal(id, 120 + i * 24, "ensalada " + id, [])));
  const stools = ["a", "b", "c"].map((id, i) => stool("s" + i, 28 + i * 24, 7));
  const sig = Diet.buildSignals(meals, Diary.feelings(meals, [], stools));
  ok(sig.avoid.join() === "gluten", "dieta: diarrea tras comidas con gluten → gluten sospechoso", JSON.stringify(sig.avoid));
  ok(sig.baseline === null, "las deposiciones no distorsionan el nivel medio de bienestar");
  const ctx = Diet.contextPayload(sig, B.contextPayload(stools, NOW));
  ok(ctx.bowel && ctx.bowel.total === 3 && ctx.bowel.counts[6] === 3, "contextPayload admite el resumen digestivo");
  ok(Diet.contextPayload(sig).bowel === undefined, "sin resumen digestivo no hay campo");
  const c = Diet.compare({ id: "p" }, meals, Diary.feelings(meals, [], stools));
  ok(c.with.n === 0 && c.without.n === 0, "comparar con/sin plan ignora las deposiciones");
}

console.log("3. Proxies /api/diary y /api/diet");
const KEY = "fake-claude-key-not-real-0000";
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "ok", causes: [], meals: [], rationale: "r", mode: "equilibrada", avoid: [], tips: [] }) }], stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } });
};
const callFn = async (file, body) => {
  sent = [];
  const { onRequest } = await import(pathToFileURL(path.join(root, file)).href);
  const res = await onRequest({ request: new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
};
{
  const bowel = [{ h: 1.5, type: 7, pain: true, urgency: true, blood: false }, { h: 3, type: 9 }, { h: 5, type: 1, blood: true, note: "SECRETO" }];
  const r = await callFn("functions/api/diary.js", {
    provider: "claude", key: KEY, entry: { text: "Tripa mal", time: "22:00", level: 2, symptoms: [] },
    meals: [{ ref: "m1", h: 3, d: "pizza", comps: [], ings: ["lactosa"] }], bowel
  });
  const prompt = sent[0].body.messages[0].content;
  ok(r.status === 200 && /Deposiciones de las 24 h anteriores/.test(prompt) && /tipo 7 hace 1.5 h \+dolor \+urgencia/.test(prompt), "diary: el prompt lleva las deposiciones", prompt.slice(-600));
  ok(!/tipo 9/.test(prompt) && !prompt.includes("SECRETO"), "diary: tipos inválidos y notas fuera");
  ok(/sangre en heces: pon urgent a true/.test(prompt), "diary: con sangre pide urgent y consulta");
  ok(!r.text.includes(KEY), "diary: sin eco de la clave");
  await callFn("functions/api/diary.js", { provider: "claude", key: KEY, entry: { text: "x" }, meals: [] });
  ok(!/Deposiciones/.test(sent[0].body.messages[0].content), "diary: sin deposiciones no hay línea");
}
{
  const ctx = { avoid: [], suspects: [], recent: [], bowel: { days: 14, counts: [0, 1, 2, 3, 0, 4, 5], pain: 2, urgency: 1, blood: 0 } };
  await callFn("functions/api/diet.js", { provider: "claude", key: KEY, scope: "day", context: ctx });
  const prompt = sent[0].body.messages[0].content;
  ok(sent.length === 1 && /Senal digestiva, deposiciones de los ultimos 14 dias/.test(prompt) && /tipo 6: 4, tipo 7: 5/.test(prompt) && /Con dolor: 2/.test(prompt), "diet: el prompt lleva el resumen digestivo", prompt.slice(-500));
  await callFn("functions/api/diet.js", { provider: "claude", key: KEY, scope: "day", context: { avoid: [], bowel: { counts: [1, 2] } } });
  ok(!/Senal digestiva/.test(sent[0].body.messages[0].content), "diet: resumen malformado se ignora");
}

console.log("4. providers.js reenvía deposiciones");
{
  const calls = [];
  const sb = { window: {}, console, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { summary: "x", causes: [] } }), { status: 200 }); } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/providers.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const P = sb.window.IntolProviders;
  await P.registry.claude.analyzeDiary({ entry: { text: "x" }, meals: [], suspects: [], bowel: [{ h: 1, type: 6 }] }, KEY, "", {});
  await P.registry.groq.analyzeDiary({ entry: { text: "x" }, meals: [], suspects: [] }, "gsk_x", "", {});
  ok(calls[0].url === "/api/diary" && calls[0].body.bowel[0].type === 6 && !("bowel" in calls[1].body), "analyzeDiary → /api/diary con bowel solo si hay");
}

console.log("5. Store: guardado, exportación y «Borrar todo»");
{
  const mem = {};
  const sb = { window: {}, console, localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }, indexedDB: { deleteDatabase: () => ({}) } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/store.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const S = sb.window.IntolStore;
  ok(Array.isArray(S.getBowel()) && S.getBowel().length === 0, "sin datos → []");
  S.saveBowel([{ id: "x", type: 4, at: 1 }]);
  ok(mem["intol.bowel.v1"] && S.getBowel()[0].type === 4, "se guarda en localStorage (intol.bowel.v1)");
  S.wipe();
  ok(!mem["intol.bowel.v1"], "Borrar todo limpia las deposiciones");
}
{
  const app = readFileSync(path.join(root, "js/app.js"), "utf8");
  ok(/const data = \{ meals, diary, diets, bowel: stools,/.test(app), "la exportación JSON incluye bowel");
  ok(/stools = \[\];/.test(app) && /it\.b\) \{ wrap\.appendChild\(BowelUI\.card/.test(app) && /BowelUI\.renderSummary/.test(app), "app.js: borrar todo vacía, timeline y Resumen pintan deposiciones");
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  ok(/js\/features\/bowel\.js/.test(html) && /js\/features\/bowel-ui\.js/.test(html) && /id="bowelSummary"/.test(html), "index.html carga los módulos y tiene el hueco del Resumen");
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
