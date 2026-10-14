// Intolerancias · tests/mood-sleep.test.mjs — node tests/mood-sleep.test.mjs
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
const sandbox = { window: {}, console, Date };
vm.createContext(sandbox);
for (const f of ["js/data.js", "js/diet.js", "js/diary.js", "js/features/mood-sleep.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox);
}
const MS = sandbox.window.IntolMoodSleep;
const Diary = sandbox.window.IntolDiary;
const Diet = sandbox.window.IntolDiet;

const NOW = new Date(2026, 9, 13, 22, 0).getTime(); // martes 13-oct-2026
const D = (back) => MS.dayKey(NOW - back * 24 * H);
const uid = (d) => "id-" + d;

console.log("1. Registro rápido: un registro por día, 1–2 toques");
{
  let r = [];
  r = MS.upsert(r, D(0), { mood: 4 }, NOW, uid);
  ok(r.length === 1 && r[0].day === "2026-10-13" && r[0].mood === 4 && r[0].tags.length === 0 && r[0].sleep === null, "un toque en la carita → registro del día con solo ánimo");
  r = MS.upsert(r, D(0), { tags: MS.toggleTag(MS.forDay(r, D(0)), "estres") }, NOW, uid);
  ok(r.length === 1 && r[0].tags.join() === "estres" && r[0].mood === 4, "segundo toque (etiqueta) actualiza el mismo día");
  r = MS.upsert(r, D(0), { tags: MS.toggleTag(MS.forDay(r, D(0)), "estres") }, NOW, uid);
  ok(r[0].tags.length === 0, "tocar otra vez la etiqueta la quita");
  r = MS.upsert(r, D(0), { sleep: { hours: 6.5, quality: 2 } }, NOW, uid);
  ok(r[0].sleep.hours === 6.5 && r[0].sleep.quality === 2, "sueño: horas + calidad 1–5");
  r = MS.upsert(r, D(0), { mood: 4 === r[0].mood ? null : 4 }, NOW, uid);
  ok(r[0].mood === null && r[0].sleep.hours === 6.5, "quitar el ánimo conserva el sueño");
  r = MS.upsert(r, D(0), { sleep: null }, NOW, uid);
  ok(r.length === 0, "día sin nada → el registro desaparece");
  r = MS.upsert([], D(1), { mood: 9, tags: ["estres", "inventada", "estres"], sleep: { hours: 99, quality: 7 } }, NOW, uid);
  ok(r[0].mood === null && r[0].tags.join() === "estres" && r[0].sleep.hours === 16 && r[0].sleep.quality === null, "valores fuera de rango o desconocidos se sanean");
  ok(MS.validHours("7.3") === 7.5 && MS.validHours(0) === null && MS.validHours("x") === null && MS.validHours(null) === null, "horas: pasos de 0,5; 0 o texto → null");
  ok(MS.remove(r, D(1)).length === 0, "remove borra el día");
  ok(MS.MOODS.length === 5 && MS.SLEEP_QUALITY.length === 5 && MS.TAGS.some((t) => t.id === "estres") && MS.TAGS.some((t) => t.id === "cansancio") &&
    MS.TAGS.some((t) => t.id === "ansiedad") && MS.TAGS.some((t) => t.id === "energia"), "5 emojis de ánimo, calidad 1–5 y etiquetas estrés/cansancio/ansiedad/energía");
}
{
  const dirty = [
    { day: "2026-10-12", mood: 3, at: 1 }, { day: "2026-10-12", mood: 5, at: 2 }, { day: "basura", mood: 3 },
    null, { day: "2026-10-11", mood: null, tags: [], sleep: null }, { day: "2026-10-10", sleep: { hours: 7 } }
  ];
  const n = MS.normalize(dirty);
  ok(n.length === 2 && n[0].day === "2026-10-12" && n[0].mood === 5 && n[1].day === "2026-10-10" && n[1].sleep.quality === null, "normalize: dedupe por día (gana el último), descarta vacíos/ilegibles, orden descendente");
  ok(MS.normalize("x").length === 0 && MS.normalize(undefined).length === 0, "normalize tolera datos corruptos");
}

console.log("2. Tendencia semanal (Resumen)");
{
  let r = [];
  const put = (back, mood, h, q, tags) => { r = MS.upsert(r, D(back), { mood, sleep: h == null ? null : { hours: h, quality: q }, tags: tags || [] }, NOW, uid); };
  [[0, 4, 7, 4], [1, 3, 6, 3, ["estres"]], [2, 2, 5, 2, ["estres", "cansancio"]], [3, 4, 8, 5], [4, 5, 8, 5, ["energia"]]].forEach((x) => put(...x));
  [[7, 2, 5, 2], [8, 3, 6, 3], [9, 2, 5.5, 2]].forEach((x) => put(...x));
  const w = MS.weekTrend(r, NOW);
  ok(w.rows.length === 7 && w.rows[6].day === D(0) && w.rows[0].day === D(6), "7 días, el último es hoy");
  ok(w.logged === 5 && w.avgMood === 3.6 && w.avgHours === 6.8 && w.avgQuality === 3.8, "medias de la semana", JSON.stringify([w.logged, w.avgMood, w.avgHours, w.avgQuality]));
  ok(w.delta.mood === 1.3 && w.delta.hours === 1.3 && w.prevLogged === 3, "cambio frente a la semana anterior", JSON.stringify(w.delta));
  ok(w.tags[0].id === "estres" && w.tags[0].n === 2, "etiqueta más frecuente primero");
  ok(MS.weekTrend([], NOW).logged === 0 && MS.weekTrend([], NOW).avgMood === null && MS.weekTrend([], NOW).delta.mood === null, "sin datos → sin medias ni cambios");
  ok(MS.shiftDay("2026-10-26", 1) === "2026-10-27" && MS.shiftDay("2026-03-29", -1) === "2026-03-28" && MS.shiftDay("2026-10-25", 1) === "2026-10-26", "días correctos al cruzar cambios de hora");
}

console.log("3. Contexto para el diario (/api/diary) y análisis local");
{
  let r = MS.upsert([], D(0), { mood: 2, tags: ["estres", "cansancio"], sleep: { hours: 5, quality: 2 } }, NOW, uid);
  const ctx = MS.entryContext(r, NOW - 3 * H);
  ok(ctx.sleepH === 5 && ctx.sleepQ === 2 && ctx.mood === 2 && ctx.lowSleep && ctx.stress && ctx.lowMood, "entryContext del día de la entrada con banderas");
  ok(MS.entryContext(r, NOW - 3 * 24 * H) === null, "sin registro ese día → null");
  const t = MS.describeContext(ctx);
  ok(/dormiste 5 h \(calidad 2\/5\)/.test(t) && /ánimo 2\/5/.test(t) && /estrés/.test(t) && /Dormir poco y el estrés y el ánimo bajo pueden agravar/.test(t), "describeContext legible", t);
  ok(MS.describeContext(null) === "" && !/agravar/.test(MS.describeContext(MS.entryContext(MS.upsert([], D(0), { mood: 4, sleep: { hours: 8, quality: 5 } }, NOW, uid), NOW))), "sin factores negativos no advierte");

  const meals = [{ id: "pizza", createdAt: NOW - 2 * H, description: "pizza con queso", feeling0: 3, ingredients: [{ id: "lactosa", source: "local" }] }];
  const e = { id: "e1", at: NOW, createdAt: NOW, text: "tripa hinchada", level: 2, symptoms: ["hinchazón"] };
  const wb = { mood: ctx.mood, tags: ctx.tags, sleepH: ctx.sleepH, sleepQ: ctx.sleepQ };
  const { body } = Diary.payload(e, meals, [], null, wb);
  ok(JSON.stringify(body.wellbeing) === JSON.stringify(wb), "Diary.payload incluye wellbeing (ánimo, etiquetas, horas, calidad)");
  ok(!("wellbeing" in Diary.payload(e, meals, []).body), "sin registros no se manda wellbeing");
  ok(!/"day"|"id"|2026-10/.test(JSON.stringify(body.wellbeing)), "wellbeing sin fechas ni ids");
}

console.log("4. Contexto para la dieta y factores vs síntomas");
{
  let r = [];
  const put = (back, mood, h, q, tags) => { r = MS.upsert(r, D(back), { mood, sleep: h == null ? null : { hours: h, quality: q }, tags: tags || [] }, NOW, uid); };
  put(0, 4, 8, 4); put(1, 2, 5, 2, ["estres"]); put(2, 3, 5.5, 3, ["ansiedad"]); put(3, 4, 7.5, 4); put(4, 3, 8, 4); put(5, 2, 4.5, 1, ["estres"]);
  const dc = MS.dietContext(r, NOW);
  ok(dc.days === 6 && dc.lowSleepDays === 3 && dc.stressDays === 3 && dc.lowMoodDays === 2 && dc.avgSleepH === 6.4 && dc.tags[0] === "estres",
    "dietContext: días, poco sueño, estrés, ánimo bajo y medias", JSON.stringify(dc));
  ok(MS.dietContext([], NOW) === null, "sin registros → null (no se manda nada)");

  const bad = new Set([D(1), D(2), D(5)]);
  const fs = MS.factors(r, bad);
  ok(fs.length >= 2 && fs[0].id === "pocoSueno" && fs[0].badWith === 3 && fs[0].withN === 3 && fs[0].baseRate === 0, "factores: poco sueño coincide con los 3 días de malestar", JSON.stringify(fs));
  ok(/Con dormir poco: malestar 3 de 3 días \(sin ello, 0%\)/.test(MS.factorsText(fs)), "factorsText legible", MS.factorsText(fs));
  ok(MS.factors(r, new Set([D(1)])).length === 0, "con <2 días de malestar no se afirma nada");
  ok(MS.factors(r, new Set([D(0), D(3), D(4)])).length === 0, "malestar en días sin factor → sin factores");

  const plan = Diet.localPlan("day", "", [], dc);
  ok(plan.tips.length === 4 && /Duermes poco/.test(plan.tips[0]) && /estrés/.test(plan.tips[1]), "plan local: consejos de sueño y estrés si la semana lo pide", JSON.stringify(plan.tips));
  ok(Diet.localPlan("day", "", []).tips.length === 2 && Diet.localPlan("day", "", [], { days: 3, avgSleepH: 8, lowSleepDays: 0, stressDays: 0 }).tips.length === 2, "sin factores el plan local no cambia");
  const sig = { avoid: [], suspects: [], recent: [], baseline: null };
  ok(Diet.contextPayload(sig, null, dc).wellbeing.days === 6 && !("wellbeing" in Diet.contextPayload(sig)), "contextPayload incluye wellbeing solo si existe");
}

console.log("5. Proxies: /api/diary y /api/diet aceptan y sanean wellbeing");
const KEY = "fake-claude-key-not-real-0000";
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } });
};
const call = async (mod, body) => {
  sent = [];
  const req = new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await mod.onRequest({ request: req });
  return { status: res.status, text: await res.text() };
};
{
  const diary = await import(pathToFileURL(path.join(root, "functions/api/diary.js")).href);
  const base = { provider: "claude", key: KEY, entry: { text: "tripa hinchada", time: "22:00", level: 2, symptoms: ["hinchazón"] },
    meals: [{ ref: "m1", h: 2, time: "20:00", d: "pizza", food: "", comps: [], ings: ["lactosa"], summary: "" }] };
  await call(diary, { ...base, wellbeing: { mood: 2, tags: ["estres", "cansancio", "<script>", 5], sleepH: 5, sleepQ: 2, extra: "no" } });
  const p = sent[0].messages[0].content;
  ok(/Contexto de ese dia \(animo y sueno\): durmio 5 h; calidad del sueno 2\/5; animo 2\/5; etiquetas: estres, cansancio\./.test(p), "diario: el prompt lleva ánimo, sueño y etiquetas válidas", p.split("\n").find((l) => /Contexto de ese/.test(l)));
  ok(!/script|extra/.test(p) && /nunca van en causes/.test(p), "diario: etiquetas desconocidas fuera y el contexto no es causa citable");
  await call(diary, base);
  ok(!/Contexto de ese dia/.test(sent[0].messages[0].content), "diario sin wellbeing: prompt igual que antes");
  await call(diary, { ...base, wellbeing: { mood: 99, tags: [], sleepH: 99, sleepQ: 0 } });
  ok(!/Contexto de ese dia/.test(sent[0].messages[0].content), "diario: wellbeing inválido se ignora");

  const diet = await import(pathToFileURL(path.join(root, "functions/api/diet.js")).href);
  const dbase = { provider: "claude", key: KEY, scope: "day", context: { avoid: ["gluten"], suspects: [], recent: [], baseline: 3 } };
  await call(diet, { ...dbase, context: { ...dbase.context, wellbeing: { days: 5, avgMood: 3.2, avgSleepH: 5.8, avgSleepQ: 2.6, lowSleepDays: 3, stressDays: 2, lowMoodDays: 1, tags: ["estres", "xx"],
    factors: [{ id: "pocoSueno", badWith: 3, withN: 3 }, { id: "inventado", badWith: 1, withN: 1 }] } } });
  const dp = sent[0].messages[0].content;
  ok(/Contexto de animo y sueno \(ultima semana\): 5 dia\(s\) registrados de los ultimos 7; sueno medio 5.8 h; calidad media del sueno 2.6\/5; animo medio 3.2\/5; 3 dia\(s\) con poco sueno; 2 dia\(s\) con estres o ansiedad; 1 dia\(s\) con animo bajo; etiquetas frecuentes: estres\./.test(dp),
    "dieta: el prompt lleva el contexto de la semana", dp.split("\n").find((l) => /Contexto de animo/.test(l)));
  ok(/dormir poco \(3\/3 dias con malestar\)/.test(dp) && !/inventado/.test(dp), "dieta: factores conocidos con su coincidencia; desconocidos fuera");
  await call(diet, dbase);
  ok(!/Contexto de animo/.test(sent[0].messages[0].content), "dieta sin wellbeing: prompt igual que antes");
  await call(diet, { ...dbase, context: { ...dbase.context, wellbeing: { days: 0 } } });
  ok(!/Contexto de animo/.test(sent[0].messages[0].content), "dieta: wellbeing vacío se ignora");
}

console.log("6. Cliente: providers.js y store.js");
{
  const calls = [];
  const sb = { window: {}, console, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { summary: "x", causes: [] } }), { status: 200 }); } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/providers.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const P = sb.window.IntolProviders;
  const wb = { mood: 2, tags: ["estres"], sleepH: 5, sleepQ: 2 };
  await P.registry.claude.analyzeDiary({ entry: { text: "x" }, meals: [], suspects: [], wellbeing: wb }, KEY, "", {});
  await P.registry.groq.analyzeDiary({ entry: { text: "x" }, meals: [], suspects: [], wellbeing: wb }, "gsk_x", "", {});
  ok(calls.length === 2 && calls.every((c) => c.url === "/api/diary" && JSON.stringify(c.body.wellbeing) === JSON.stringify(wb)), "analyzeDiary (Claude y Groq) manda wellbeing a /api/diary");
  await P.registry.claude.analyzeDiary({ entry: { text: "x" }, meals: [], suspects: [] }, KEY, "", {});
  ok(!("wellbeing" in calls[2].body), "sin wellbeing no se envía la clave");
}
{
  const mem = {};
  const sb = { window: {}, console, localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }, indexedDB: { deleteDatabase: () => ({}) } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/store.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const S = sb.window.IntolStore;
  ok(Array.isArray(S.getMoodSleep()) && S.getMoodSleep().length === 0, "store: sin datos → []");
  S.saveMoodSleep([{ id: "a", day: "2026-10-13", mood: 4, tags: [], sleep: null }]);
  ok(S.getMoodSleep().length === 1 && /intol\.moodsleep\.v1/.test(Object.keys(mem).join()), "store: se guarda en localStorage (intol.moodsleep.v1)");
  S.wipe();
  ok(!mem["intol.moodsleep.v1"] && S.getMoodSleep().length === 0, "«Borrar todo» (wipe) elimina ánimo y sueño");
}

console.log("7. Integración en la app (comprobaciones estáticas de js/app.js e index.html)");
{
  const app = readFileSync(path.join(root, "js/app.js"), "utf8");
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  ok(/const data = \{ meals, diary, diets,.*moodSleep: moodRecs/.test(app), "la exportación JSON incluye moodSleep");
  ok(/moodRecs = \[\];/.test(app) && /S\.wipe\(\)/.test(app), "«Borrar todo» vacía el estado en memoria y el almacén");
  ok(/MS\.dayStart\(r\.day\)/.test(app) && /moodEntryCard/.test(app), "el timeline pinta los registros de ánimo y sueño");
  ok(/renderWeekTrend/.test(app) && /id="weekTrend"/.test(html), "el Resumen muestra la tendencia semanal");
  ok(/Diary\.payload\(e, all, suspects, stools, wellbeing\)/.test(app) && /Diet\.contextPayload\(sig, Bowel\.contextPayload\(stools, Date\.now\(\)\), dietWellbeing\(\)\)/.test(app), "diario y dieta reciben el contexto");
  ok(/Home\.registerTile\(\{\s*id: "animo"[\s\S]*?onOpen: \(\) => openMood\(\)/.test(app), "se engancha al Home como tile «Ánimo y sueño» (IntolHome.registerTile, mismo id que el placeholder)");
  ok(html.indexOf("js/features/mood-sleep.js") > html.indexOf("js/diary.js") && html.indexOf("js/features/mood-sleep.js") < html.indexOf("js/app.js"), "mood-sleep.js se carga antes de app.js");
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
