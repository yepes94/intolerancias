// Intolerancias · tests/diary.test.mjs — node tests/diary.test.mjs
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

const H = 3600e3;
const sandbox = { window: {}, console, Date };
vm.createContext(sandbox);
for (const f of ["js/data.js", "js/diet.js", "js/diary.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox);
const Diary = sandbox.window.IntolDiary;
const Diet = sandbox.window.IntolDiet;
const Data = sandbox.window.IntolData;

const NOW = new Date(2026, 9, 13, 22, 0).getTime();
const meal = (id, hoursAgo, desc, ings, extra) => ({
  id, createdAt: NOW - hoursAgo * H, description: desc, feeling0: 3,
  ingredients: (ings || []).map((i) => ({ id: i, source: "local" })), thumb: "data:image/jpeg;base64,AAAA", ...(extra || {})
});

console.log("1. js/diary.js (síntomas, ventana 24 h, análisis local, migración)");
{
  ok(Diary.extractSymptoms("Tengo la tripa hinchada, muchos gases y me duele la barriga").join() === "hinchazón,gases,dolor abdominal",
    "texto libre → hinchazón, gases, dolor abdominal");
  ok(Diary.extractSymptoms("Ardor de estómago y dolor de cabeza").join() === "acidez,dolor de cabeza", "ardor → acidez; dolor de cabeza");
  ok(Diary.extractSymptoms("Estoy genial").length === 0, "sin síntomas → []");
  ok(Diary.redFlags("me cuesta, dificultad para respirar y labios hinchados") && !Diary.redFlags("algo de gases"), "señales de alarma detectadas solo cuando toca");

  const meals = [
    meal("pizza", 1.5, "pizza con queso y cerveza", ["lactosa", "gluten", "alcohol"]),
    meal("ensalada", 8, "ensalada de pollo", []),
    meal("tostada", 14, "tostada con tomate", [], { analysis: { food: "pan de trigo", components: ["gluten", "trigo"] } }),
    meal("vieja", 30, "paella de ayer", ["gluten"])
  ];
  const w = Diary.windowMeals(meals, NOW);
  ok(w.map((m) => m.id).join() === "pizza,ensalada,tostada", "ventana: solo comidas de las 24 h anteriores, la más cercana primero");

  const e = { id: "e1", at: NOW, createdAt: NOW, text: "Tripa hinchada y gases", level: 2, symptoms: Diary.extractSymptoms("Tripa hinchada y gases") };
  const loc = Diary.localAnalyze(e, meals, []);
  ok(loc.causes[0].mealId === "pizza" && loc.causes[0].ingredients.includes("lactosa"), "local: pizza hace 1,5 h con lactosa encaja (ventana 0,5–2 h + hinchazón)", JSON.stringify(loc.causes[0]));
  ok(loc.causes[0].likelihood === "media" && /hace 1 h 30 min/.test(loc.causes[0].reason) && /hinchazón/.test(loc.causes[0].reason), "local: probabilidad y motivo explicados", loc.causes[0].reason);
  ok(loc.causes.some((c) => c.mealId === "tostada"), "local: componentes del análisis IA guardado cuentan (gluten de la tostada)");
  ok(!loc.causes.some((c) => c.mealId === "vieja"), "local: comida de hace 30 h fuera");
  ok(/Lo que más encaja/.test(loc.summary) && !loc.urgent, "local: resumen legible, sin urgencia");
  const known = Diary.localAnalyze(e, meals, ["lactosa"]);
  ok(known.causes[0].likelihood === "alta" && /otras veces/.test(known.causes[0].reason), "local: un sospechoso del historial sube a probabilidad alta");
  ok(/No hay comidas/.test(Diary.localAnalyze({ ...e, at: NOW + 48 * H }, meals, []).summary), "local sin comidas en 24 h → lo dice");
  ok(Diary.localAnalyze({ ...e, text: "vomito con sangre" }, meals, []).urgent, "local: señal de alarma → urgent");

  const { body, refs } = Diary.payload(e, meals, ["gluten"]);
  const raw = JSON.stringify(body);
  ok(body.meals.length === 3 && body.meals[0].ref === "m1" && refs.m1 === "pizza" && body.meals[0].h === 1.5, "payload: refs m1… y horas transcurridas");
  ok(!/data:image|thumb|"id"|pizza"/.test(raw.replace(/pizza con/g, "")) && !raw.includes("ensalada\",\"id"), "payload sin fotos ni ids internos", raw.slice(0, 200));
  ok(body.meals[2].comps.join() === "gluten,trigo" && body.meals[2].ings.includes("gluten") && body.meals[2].food === "pan de trigo", "payload lleva análisis y componentes guardados");
  ok(body.entry.time === "22:00" && body.entry.level === 2 && body.suspects[0] === "gluten", "payload: hora, nivel y sospechosos");

  const mapped = Diary.applyRefs({ summary: "x", causes: [{ ref: "m1", components: ["queso"], ingredients: ["lactosa", "inventado"], likelihood: "alta", reason: "r" }, { ref: "m9" }], advice: "a", urgent: false }, refs);
  ok(mapped.causes.length === 1 && mapped.causes[0].mealId === "pizza" && mapped.causes[0].ingredients.join() === "lactosa", "resultado IA: ref → comida real; refs desconocidas y claves inventadas fuera");

  // Atribución para Resumen y Dieta
  e.analysis = { causes: [{ mealId: "pizza" }] };
  ok(Diary.linkedMeals(e, meals).map((m) => m.id).join() === "pizza", "entrada de malestar con causa citada → solo esa comida");
  const fine = { id: "e2", at: NOW, text: "bien", level: 5, symptoms: [] };
  ok(Diary.linkedMeals(fine, meals).length === 3 && Diary.looksFine(fine), "entrada positiva → todas las comidas de la ventana (sin buscar causas)");
  const recs = Diary.feelings(meals, [e, fine]);
  ok(recs.length === 4 && recs.every((r) => r.entryId && r.doneAt && r.feeling), "feelings: un registro por (entrada, comida)");
  ok(Diary.entryScore({ text: "me duele la tripa", symptoms: ["dolor abdominal"] }) === 2 && Diary.entryScore({ text: "ok", symptoms: [] }) === 3, "sin nivel: 2 si cuenta molestias, 3 si no");
}
{
  // Migración de check-ins
  const meals = [meal("m1", 5, "pasta", ["gluten"])];
  const checkins = [
    { id: "c1", mealId: "m1", scheduledAt: NOW - 3 * H, doneAt: NOW - 3 * H, prompt: "Han pasado ~2 h. ¿Cómo te sientes?", feeling: 2, symptoms: ["hinchazón"], note: "pesada" },
    { id: "c2", mealId: "m1", scheduledAt: NOW + H, doneAt: null, prompt: "pendiente" },
    { id: "c3", mealId: null, scheduledAt: NOW, doneAt: NOW, prompt: "Check-in de dieta de prueba", feeling: 4, symptoms: [], note: "", dietId: "p1" }
  ];
  const out = Diary.mergeLegacy([], checkins);
  ok(out.length === 2 && out.every((x) => x.legacy), "check-ins respondidos → 2 entradas históricas; pendiente descartado");
  const c1 = out.find((x) => x.id === "ck-c1");
  ok(c1.text === "pesada" && c1.level === 2 && c1.symptoms[0] === "hinchazón" && c1.mealId === "m1" && /2 h/.test(c1.legacy.prompt), "se conservan nota, nivel, síntomas, comida y pregunta");
  ok(out.find((x) => x.id === "ck-c3").dietId === "p1", "se conserva el enlace a la dieta");
  ok(Diary.mergeLegacy(out, checkins).length === 2, "migración idempotente");
  const recs = Diary.feelings(meals, out);
  ok(recs.find((r) => r.entryId === "ck-c1").mealId === "m1" && recs.find((r) => r.entryId === "ck-c1").feeling === 2, "histórico enlazado a su comida para Resumen/Dieta");
}
{
  // Dieta con el diario
  const meals = [
    meal("a", 30, "bocadillo de jamón", ["gluten"]), meal("b", 54, "pasta", ["gluten"]), meal("c", 78, "pan", ["gluten"]),
    meal("d", 102, "ensalada", []), meal("e", 126, "arroz", [])
  ];
  const entries = ["a", "b", "c"].map((id, i) => ({ id: "x" + i, at: meals.find((m) => m.id === id).createdAt + 2 * H, text: "hinchada", level: 2, symptoms: ["hinchazón"] }))
    .concat(["d", "e"].map((id, i) => ({ id: "y" + i, at: meals.find((m) => m.id === id).createdAt + 2 * H, text: "bien", level: 5, symptoms: [] })));
  const sig = Diet.buildSignals(meals, Diary.feelings(meals, entries));
  ok(sig.avoid.join() === "gluten" && sig.mealsWithData === 5, "señales de dieta con el diario: excluye gluten", JSON.stringify(sig.avoid));
  ok(sig.baseline === 3.2, "baseline cuenta cada entrada una vez", String(sig.baseline));
  const plan = { id: "p1" };
  const dm = [meal("d1", 3, "Comida (dieta)", [], { dietId: "p1" }), meal("n1", 2, "pizza", ["gluten"])];
  const de = [{ id: "z1", at: NOW, text: "bien", level: 4, symptoms: [], dietId: "p1" }, { id: "z2", at: NOW - 30 * H, text: "fatal", level: 1, symptoms: ["gases"] }];
  const c = Diet.compare(plan, dm, Diary.feelings(dm, de));
  ok(c.with.n === 1 && c.with.avg === 4 && c.without.n === 1 && c.without.avg === 1, "comparación con/sin plan: una entrada cuenta una vez aunque enlace 2 comidas", JSON.stringify(c));
}
{
  // Recordatorio
  const day = new Date(2026, 9, 13, 12, 0).getTime();
  const m = [{ id: "m", createdAt: day }];
  ok(!Diary.reminderState(m, [], new Date(2026, 9, 13, 20, 59).getTime(), "21:00").due, "antes de las 21:00 → no toca");
  const st = Diary.reminderState(m, [], new Date(2026, 9, 13, 21, 0).getTime(), "21:00");
  ok(st.due && st.when === "hoy" && st.meals === 1, "21:00 con comida y sin diario → toca hoy");
  ok(!Diary.reminderState(m, [{ at: day + H, createdAt: day + H }], new Date(2026, 9, 13, 21, 5).getTime(), "21:00").due, "con una entrada hoy → no toca");
  ok(!Diary.reminderState([], [], new Date(2026, 9, 13, 21, 5).getTime(), "21:00").due, "sin comidas hoy → no toca");
  ok(!Diary.reminderState(m, [], new Date(2026, 9, 13, 21, 5).getTime(), "21:00", "2026-10-13").due, "descartado hoy → no toca");
  const y = Diary.reminderState(m, [], new Date(2026, 9, 14, 9, 0).getTime(), "21:00");
  ok(y.due && y.when === "ayer" && y.day === "2026-10-13", "al abrir al día siguiente → pendiente de ayer");
  ok(!Diary.reminderState(m, [], new Date(2026, 9, 14, 9, 0).getTime(), "22:30", "2026-10-13").due, "pendiente de ayer descartado → no toca");
  ok(new Date(Diary.nextReminderAt(new Date(2026, 9, 13, 21, 30).getTime(), "21:00")).getDate() === 14 &&
    new Date(Diary.nextReminderAt(new Date(2026, 9, 13, 8, 0).getTime(), "21:00")).getHours() === 21, "próximo aviso: hoy a las 21:00 o mañana");
}

console.log("2. functions/api/diary.js (validación, taxonomía, #17, privacidad)");
const { onRequest } = await import(pathToFileURL(path.join(root, "functions/api/diary.js")).href);
const KEY = "fake-claude-key-not-real-0000";
let sent = [];
let upstream = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); sent.push({ url, init, body }); return upstream(body, sent.length); };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const call = async (method, body) => {
  sent = [];
  const req = new Request("https://x/api/diary", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await onRequest({ request: req });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null, cc: res.headers.get("cache-control") };
};
const claude = (content, stop, usage) => () => jres({ content, stop_reason: stop || "end_turn", usage: usage || { input_tokens: 600, output_tokens: 300 } });
const reqBody = {
  entry: { text: "Tripa hinchada y gases desde la cena", time: "22:00", level: 2, symptoms: ["hinchazón", "gases"] },
  meals: [{ ref: "m1", h: 1.5, time: "20:30", d: "pizza con queso y cerveza", food: "pizza", comps: ["queso", "masa de trigo"], ings: ["lactosa", "gluten", "alcohol"], summary: "Vigila lactosa" },
    { ref: "m2", h: 8, time: "14:00", d: "ensalada", food: "", comps: [], ings: [], summary: "" }],
  suspects: ["lactosa"]
};
const good = { summary: "Lo más probable es la lactosa del queso.", causes: [
  { ref: "m1", components: ["queso"], ingredients: ["lactosa", "inventado"], likelihood: "Alta", reason: "1,5 h encaja con lactosa" },
  { ref: "m7", components: ["x"], likelihood: "media", reason: "ref que no existe" }], advice: "Prueba sin lácteos", urgent: false };
{
  const r = await call("GET");
  ok(r.status === 200 && r.json.service === "diary-proxy" && r.cc === "no-store", "GET salud 200 + no-store");
  ok((await call("POST", { provider: "claude", ...reqBody })).json.kind === "auth", "sin key → 401 auth");
  const h = await call("POST", { provider: "hermes", key: KEY, ...reqBody });
  ok(h.status === 501 && h.json.kind === "notimpl" && !h.text.includes(KEY), "hermes → 501 notimpl sin eco de key");
  ok((await call("POST", { provider: "xxx", key: KEY })).status === 400, "proveedor desconocido → 400");
  const nt = await call("POST", { provider: "claude", key: KEY, entry: { text: "  " }, meals: [] });
  ok(nt.json.kind === "badrequest" && sent.length === 0, "sin texto → 400 badrequest sin llamar al proveedor");
}
{
  upstream = claude([{ type: "thinking", thinking: '{"summary":"BORRADOR"}', signature: "x" }, { type: "text", text: "```json\n" + JSON.stringify(good) + "\n```" }]);
  const r = await call("POST", { provider: "claude", key: KEY, ...reqBody });
  ok(r.status === 200 && r.json.ok && r.json.action === "diary", "Claude con thinking + text + fences → 200", r.text.slice(0, 200));
  const c = r.json.result.causes;
  ok(c.length === 1 && c[0].ref === "m1" && c[0].likelihood === "alta" && c[0].ingredients.join() === "lactosa", "solo refs enviadas, claves válidas, probabilidad normalizada");
  ok(!r.text.includes("BORRADOR"), "se ignoran los bloques thinking");
  const b = sent[0].body;
  ok(b.model === "claude-sonnet-5-5" && b.max_tokens === 128000 && b.thinking.type === "between_tools" && b.output_config.effort === "low",
    "#17: Sonnet 5.5 → max_tokens del modelo (128000), between_tools + effort low");
  ok(sent[0].init.headers["x-api-key"] === KEY && !r.text.includes(KEY), "key solo en la cabecera al proveedor, sin eco");
  const prompt = b.messages[0].content;
  ok(/Tripa hinchada/.test(prompt) && /m1 \| 1.5 h \(20:30\) \| pizza con queso/.test(prompt) && /lactosa 0.5-2 h/.test(prompt) && /urgent/.test(prompt) && /otras veces: lactosa/.test(prompt),
    "prompt: texto, comidas con horas, ventanas, señales de alarma y sospechosos");
  ok(!/data:image|base64/.test(prompt) && prompt.length < 4000, "prompt sin fotos y acotado (" + prompt.length + " caracteres)");
}
{
  const want = [["claude-sonnet-5", "disabled"], ["claude-haiku-5-5", "disabled"], ["claude-opus-5-5", undefined]];
  upstream = claude([{ type: "text", text: JSON.stringify(good) }]);
  for (const [model, t] of want) {
    await call("POST", { provider: "claude", key: KEY, model, ...reqBody });
    ok((sent[0].body.thinking && sent[0].body.thinking.type) === t && sent[0].body.output_config.effort === "low", `${model} → thinking ${t || "(omitido)"} + effort low (misma tabla que /api/diet)`);
  }
  await call("POST", { provider: "claude", key: KEY, model: "claude-haiku-4-5-20251001", ...reqBody });
  ok(sent[0].body.max_tokens === 64000 && !sent[0].body.thinking && !sent[0].body.output_config, "4.x → 64000 sin thinking/effort");
  upstream = (b, n) => n === 1
    ? jres({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 64000 > 32768, which is the maximum allowed number of output tokens for claude-sonnet-4-1" } }, 400)
    : claude([{ type: "text", text: JSON.stringify(good) }])();
  const r = await call("POST", { provider: "claude", key: KEY, model: "claude-sonnet-4-1", ...reqBody });
  ok(r.status === 200 && sent.length === 2 && sent[1].body.max_tokens === 32768, "max_tokens por encima del máximo → reintento con el del error");
  upstream = (b, n) => n === 1
    ? jres({ type: "error", error: { type: "rate_limit_error", message: "would exceed your rate limit of 8,000 output tokens per minute" } }, 429)
    : claude([{ type: "text", text: JSON.stringify(good) }])();
  const rl = await call("POST", { provider: "claude", key: KEY, ...reqBody });
  ok(rl.status === 200 && sent.length === 2 && sent[1].body.max_tokens === 16000, "429 por tokens de salida/minuto → 1 reintento con 16000");
}
{
  upstream = claude([{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: '{"summary":"Lo más prob' }], "max_tokens",
    { input_tokens: 600, output_tokens: 128000, output_tokens_details: { thinking_tokens: 127000 } });
  const cut = await call("POST", { provider: "claude", key: KEY, ...reqBody });
  ok(cut.json.kind === "badjson" && /razonamiento interno/.test(cut.json.message) && /Se cortó/.test(cut.json.message) && /Reanalizar/.test(cut.json.message), "corte por max_tokens → badjson con diagnóstico y acción");
  upstream = claude([{ type: "text", text: "Lo siento, no puedo." }]);
  ok((await call("POST", { provider: "claude", key: KEY, ...reqBody })).json.kind === "badjson", "prosa sin JSON → badjson");
  upstream = () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  ok((await call("POST", { provider: "claude", key: KEY, ...reqBody })).json.kind === "badjson", "200 no-JSON → badjson");
  upstream = () => new Response('{"error":"invalid x-api-key"}', { status: 401 });
  const a = await call("POST", { provider: "claude", key: KEY, ...reqBody });
  ok(a.status === 401 && a.json.kind === "auth" && !a.text.includes(KEY), "401 del proveedor → auth sin eco de key");
  upstream = () => new Response("slow down", { status: 429 });
  ok((await call("POST", { provider: "groq", key: "gsk_x", ...reqBody })).json.kind === "ratelimit", "429 → ratelimit");
  upstream = () => new Response("boom", { status: 503 });
  ok((await call("POST", { provider: "groq", key: "gsk_x", ...reqBody })).json.kind === "server", "5xx → server");
  upstream = () => { throw new TypeError("fetch failed"); };
  ok((await call("POST", { provider: "groq", key: "gsk_x", ...reqBody })).json.kind === "network", "fallo de red → network");
  upstream = () => jres({ choices: [{ message: { content: JSON.stringify({ ...good, urgent: "true" }) }, finish_reason: "stop" }] });
  const g = await call("POST", { provider: "groq", key: "gsk_x", ...reqBody });
  ok(g.status === 200 && g.json.result.urgent === true && sent[0].body.response_format.type === "json_object" && !("max_tokens" in sent[0].body) &&
    sent[0].init.headers.authorization === "Bearer gsk_x", "Groq → 200, json_object, sin max_tokens, Bearer");
  upstream = (b, n) => n === 1
    ? jres({ error: { message: "Request too large for model: tokens per minute (TPM)" } }, 413)
    : jres({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: "stop" }] });
  const g2 = await call("POST", { provider: "groq", key: "gsk_x", ...reqBody });
  ok(g2.status === 200 && sent.length === 2 && sent[1].body.max_tokens === 8192, "Groq 413 TPM → 1 reintento con 8192");
}
{
  const src = readFileSync(path.join(root, "functions/api/diary.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/console\.(log|info|warn|error|debug)/.test(code), "la Function no escribe logs");
  ok(!/(KV|D1|env\.)/.test(code), "la Function no persiste nada (sin KV/D1/env)");
  const win = JSON.parse("{" + /const WINDOWS = \{([\s\S]*?)\};/.exec(src)[1].replace(/(\w+):/g, '"$1":').replace(/,\s*$/, "") + "}");
  const same = Object.entries(Data.ONSET_WINDOWS).every(([k, w]) => win[k] && win[k][0] === w.startH && win[k][1] === w.endH);
  ok(same && Object.keys(win).length === Object.keys(Data.ONSET_WINDOWS).length, "ventanas del proxy = ONSET_WINDOWS de js/data.js");
  const diet = readFileSync(path.join(root, "functions/api/diet.js"), "utf8");
  const fn = (s) => /function claudeThinking[\s\S]*?\n}\n/.exec(s)[0];
  ok(fn(src) === fn(diet), "claudeThinking idéntica a la de /api/diet");
}

console.log("3. js/providers.js analyzeDiary");
{
  const calls = [];
  let respond = () => new Response(JSON.stringify({ ok: true, result: { summary: "x", causes: [] } }), { status: 200 });
  const sb = { window: {}, console, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return respond(); } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/providers.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const P = sb.window.IntolProviders;
  const out = await P.registry.claude.analyzeDiary(reqBody, KEY, "", {});
  ok(calls[0].url === "/api/diary" && calls[0].body.entry.text === reqBody.entry.text && calls[0].body.meals.length === 2 &&
    calls[0].body.validIngredients.includes("lactosa") && !("imageDataUrl" in calls[0].body), "Claude analyzeDiary → POST /api/diary con texto y comidas, sin foto");
  ok(out.summary === "x", "resultado del proxy llega intacto");
  let kind = null;
  respond = () => new Response(JSON.stringify({ ok: false, kind: "auth", message: "rechazada" }), { status: 401 });
  try { await P.registry.groq.analyzeDiary(reqBody, "gsk_x", "", {}); } catch (e) { kind = e.kind; }
  ok(kind === "auth", "error del proxy conserva kind (auth)");
  respond = () => new Response(JSON.stringify({ ok: true, result: { causes: "x" } }), { status: 200 });
  try { await P.registry.claude.analyzeDiary(reqBody, KEY, "", {}); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "badjson", "resultado sin forma → badjson");
  try { await P.registry.cursor.analyzeDiary(); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "notimpl", "Cursor analyzeDiary → notimpl");
  sb.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try { await P.registry.claude.analyzeDiary(reqBody, KEY, "", {}); kind = null; } catch (e) { kind = e.kind; }
  ok(kind === "network", "sin proxy → network (la app cae al análisis local)");
}

console.log("4. Store: diario y ajustes del recordatorio");
{
  const mem = { "intol.checkins.v1": "[]" };
  const sb = { window: {}, console, localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }, indexedDB: { deleteDatabase: () => ({}) } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/store.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  const S = sb.window.IntolStore;
  const st = S.getSettings();
  ok(st.reminder.enabled === true && st.reminder.time === "21:00", "recordatorio activado a las 21:00 por defecto");
  S.saveDiary([{ id: "e" }]); S.setDiaryMigrated();
  ok(S.getDiary().length === 1 && S.diaryMigrated(), "diario y marca de migración persisten");
  S.wipe();
  ok(!mem["intol.diary.v1"] && !mem["intol.checkins.v1"] && !mem["intol.diary.migrated.v1"], "Borrar todo limpia diario, check-ins antiguos y marca");
  ok(typeof S.saveCheckins === "undefined", "ya no se escriben check-ins");
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
