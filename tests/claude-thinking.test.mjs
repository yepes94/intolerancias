// Intolerancias · tests/claude-thinking.test.mjs — node tests/claude-thinking.test.mjs
// Respuestas de Claude con bloques `thinking` + `text` y config de thinking/effort por modelo.
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

const KEY = "fake-claude-key-not-real-0000";
let sent = [];
let upstream = () => { throw new Error("sin upstream"); };
globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); return upstream(body, sent.length); };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const claude = (content, stop, usage) => () => jres({ content, stop_reason: stop || "end_turn", usage: usage || { input_tokens: 957, output_tokens: 700 } });

const diet = (await import(pathToFileURL(path.join(root, "functions/api/diet.js")).href)).onRequest;
const analyze = (await import(pathToFileURL(path.join(root, "functions/api/analyze.js")).href)).onRequest;
async function call(fn, body) {
  sent = [];
  const res = await fn({ request: new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

const dayPlan = {
  mode: "equilibrada", avoid: [], rationale: "Sin señales claras: día equilibrado y ligero.",
  meals: ["desayuno", "comida", "merienda", "cena"].map((slot) => ({ slot, name: "Plato de " + slot, items: ["a", "b"], why: "ligero" })),
  tips: ["Anota cómo te sientes."]
};
const thinkingBlock = { type: "thinking", thinking: "", signature: "EuYBCkQYAiJA" };
const ctx = { avoid: [], suspects: [], recent: [{ d: "ensalada", ings: [], comps: [], f: 4, s: [] }], baseline: 4 };

console.log("1. /api/diet con bloques thinking + text");
{
  // Bloque de thinking con un JSON "trampa" dentro: solo cuentan los bloques text.
  upstream = claude([{ ...thinkingBlock, thinking: '{"meals":[{"slot":"cena","name":"BORRADOR"}]}', text: '{"meals":[{"slot":"cena","name":"BORRADOR"}]}' },
    { type: "redacted_thinking", data: "xyz" }, { type: "text", text: JSON.stringify(dayPlan) }]);
  const r = await call(diet, { provider: "claude", key: KEY, model: "claude-sonnet-5-5", scope: "day", context: ctx });
  ok(r.status === 200 && r.json.result.meals.length === 4, "thinking + redacted_thinking + text → 200 con 4 comidas", r.text.slice(0, 160));
  ok(!r.text.includes("BORRADOR"), "el contenido de los bloques thinking se ignora");
}
{
  // El caso del usuario: el thinking se come los 1200 tokens y el texto queda cortado.
  upstream = claude([thinkingBlock, { type: "text", text: '{"mode":"equilibrada","meals":[{"slot":"desayuno","name":"Cop' }], "max_tokens",
    { input_tokens: 957, output_tokens: 1200, output_tokens_details: { thinking_tokens: 1100 } });
  const r = await call(diet, { provider: "claude", key: KEY, model: "claude-sonnet-5-5", scope: "day", context: ctx });
  ok(r.json.kind === "badjson" && /stop=max_tokens/.test(r.json.message) && /bloques=\[thinking,text\]/.test(r.json.message), "corte por max_tokens con thinking → badjson con diagnóstico");
  ok(/thinking 1100/.test(r.json.message) && /razonamiento interno del modelo agotó el límite/.test(r.json.message), "el diagnóstico dice que el razonamiento agotó el límite", r.json.message);
}

console.log("2. config de thinking/effort y max_tokens por modelo (/api/diet)");
const okPlan = claude([{ type: "text", text: JSON.stringify(dayPlan) }]);
const cases = [
  ["claude-sonnet-5-5", { thinking: { type: "between_tools" }, effort: "low" }],
  ["claude-sonnet-5", { thinking: { type: "disabled" }, effort: "low" }],
  ["claude-haiku-5-5", { thinking: { type: "disabled" }, effort: "low" }],
  ["claude-opus-5", { thinking: { type: "disabled" }, effort: "low" }],
  ["claude-opus-5-5", { thinking: undefined, effort: "low" }],
  ["claude-fable-5-1", { thinking: undefined, effort: "low" }],
  ["claude-sonnet-4-6", { thinking: undefined, effort: undefined }],
  ["claude-haiku-4-5-20251001", { thinking: undefined, effort: undefined }],
];
for (const [model, want] of cases) {
  upstream = okPlan;
  const r = await call(diet, { provider: "claude", key: KEY, model, scope: "day", context: ctx });
  const b = sent[0];
  ok(r.status === 200 && JSON.stringify(b.thinking) === JSON.stringify(want.thinking) && (b.output_config && b.output_config.effort) === want.effort,
    `${model} → thinking=${JSON.stringify(want.thinking) || "(omitido)"}, effort=${want.effort || "(omitido)"}`, JSON.stringify({ t: b.thinking, o: b.output_config }));
}
{
  upstream = okPlan;
  await call(diet, { provider: "claude", key: KEY, scope: "day", context: ctx });
  ok(sent[0].model === "claude-sonnet-5-5" && sent[0].thinking.type === "between_tools", "sin modelo → claude-sonnet-5-5 (el antiguo por defecto está retirado) sin thinking previo");
  ok(sent[0].max_tokens === 128000, "día completo: sin tope propio, máximo del modelo (128000)");
  await call(diet, { provider: "claude", key: KEY, scope: "meal", slot: "cena", context: ctx });
  ok(sent[0].max_tokens === 128000, "una comida: también el máximo del modelo");
  await call(diet, { provider: "claude", key: KEY, model: "claude-haiku-4-5-20251001", scope: "day", context: ctx });
  ok(sent[0].max_tokens === 64000, "modelo 4.x → 64000");
}
{
  upstream = (b, n) => n === 1
    ? jres({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 64000 > 32768, which is the maximum allowed number of output tokens for claude-sonnet-4-1" } }, 400)
    : okPlan();
  const r = await call(diet, { provider: "claude", key: KEY, model: "claude-sonnet-4-1", scope: "day", context: ctx });
  ok(r.status === 200 && sent.length === 2 && sent[0].max_tokens === 64000 && sent[1].max_tokens === 32768, "max_tokens por encima del máximo → reintento con el que indica el error");
}
{
  upstream = (b, n) => n === 1
    ? jres({ type: "error", error: { type: "invalid_request_error", message: "output_config.effort: unsupported for this model" } }, 400)
    : okPlan();
  const r = await call(diet, { provider: "claude", key: KEY, model: "claude-futuro-9", scope: "day", context: ctx });
  ok(r.status === 200 && sent.length === 2 && sent[0].output_config && !sent[1].output_config && !sent[1].thinking, "modelo desconocido que rechaza effort → 1 reintento sin thinking/effort → 200");
  upstream = () => jres({ type: "error", error: { type: "invalid_request_error", message: "model: not found" } }, 400);
  const r2 = await call(diet, { provider: "claude", key: KEY, model: "claude-futuro-9", scope: "day", context: ctx });
  ok(r2.json.kind === "badrequest" && sent.length === 1, "400 ajeno al thinking → sin reintento, badrequest");
  ok(!r.text.includes(KEY) && !r2.text.includes(KEY), "sin eco de la key");
}
{
  upstream = () => jres({ choices: [{ message: { content: JSON.stringify(dayPlan) }, finish_reason: "stop" }] });
  await call(diet, { provider: "groq", key: "gsk_x", scope: "day", context: ctx });
  ok(!("max_tokens" in sent[0]) && !sent[0].thinking && !sent[0].output_config, "Groq: sin max_tokens (máximo del modelo), sin thinking/effort");
  upstream = (b, n) => n === 1
    ? jres({ error: { message: "Request too large for model: Limit 6000, Requested 32768. tokens per minute (TPM)" } }, 413)
    : jres({ choices: [{ message: { content: JSON.stringify(dayPlan) }, finish_reason: "stop" }] });
  const g = await call(diet, { provider: "groq", key: "gsk_x", scope: "day", context: ctx });
  ok(g.status === 200 && sent.length === 2 && sent[1].max_tokens === 8192, "Groq 413 por cuota TPM → 1 reintento con max_tokens 8192");
}

console.log("3. /api/analyze con bloques thinking + text");
{
  const analysis = { food: "pizza", components: ["gluten", "lactosa"], ingredients: ["gluten", "lactosa"], summary: "Vigila gluten y lactosa.", checkinQuestion: "¿Cómo te sientes?" };
  upstream = claude([{ ...thinkingBlock, text: '{"summary":"BORRADOR"}' }, { type: "text", text: JSON.stringify(analysis) }]);
  const r = await call(analyze, { provider: "claude", key: KEY, model: "claude-sonnet-5-5", description: "pizza" });
  ok(r.status === 200 && r.json.result.ingredients.join() === "gluten,lactosa" && !r.text.includes("BORRADOR"), "thinking + text → 200, solo se lee el text");
  ok(sent[0].max_tokens === 2500 && sent[0].thinking.type === "between_tools" && sent[0].output_config.effort === "low", "analyze: max_tokens 2500 + between_tools + effort low en Sonnet 5.5");
  upstream = claude([thinkingBlock], "max_tokens", { input_tokens: 300, output_tokens: 2500 });
  const c = await call(analyze, { provider: "claude", key: KEY, model: "claude-opus-5-5", description: "pizza" });
  ok(c.json.kind === "badjson" && /razonamiento interno/.test(c.json.message) && /Se cortó/.test(c.json.message), "analyze solo-thinking cortado → badjson con causa", c.json.message);
  ok(sent[0].output_config.effort === "low" && !sent[0].thinking, "Opus 5.5 (no admite disabled) → solo effort low");
  upstream = claude([thinkingBlock, { type: "text", text: "ok" }]);
  const p = await call(analyze, { provider: "claude", action: "ping", key: KEY, model: "claude-haiku-5-5" });
  ok(p.status === 200 && sent[0].thinking.type === "disabled" && sent[0].max_tokens === 64, "ping: thinking disabled en Haiku 5.5, max_tokens 64");
}

console.log("4. Ajustes: modelo retirado guardado");
{
  const mem = { "intol.settings.v1": JSON.stringify({ keys: { claude: "x" }, model: "claude-sonnet-4-20250514" }) };
  const sb = { window: {}, console, localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } } };
  vm.createContext(sb);
  for (const f of ["js/data.js", "js/store.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), sb);
  ok(sb.window.IntolStore.getSettings().model === "claude-sonnet-5-5", "claude-sonnet-4-20250514 guardado → claude-sonnet-5-5");
  mem["intol.settings.v1"] = JSON.stringify({ model: "claude-opus-5-5" });
  ok(sb.window.IntolStore.getSettings().model === "claude-opus-5-5", "un modelo elegido por el usuario se respeta");
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
