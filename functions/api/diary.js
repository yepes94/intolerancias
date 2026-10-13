/* Intolerancias · functions/api/diary.js
 *
 * Proxy BYOK "Diario de síntomas" (hermano de /api/analyze y /api/diet):
 * cruza lo que cuenta el usuario con las comidas de las 24 h anteriores.
 *
 * Contrato:
 *   POST /api/diary
 *   { provider: "claude"|"groq"|"hermes"|"cursor",
 *     key: "<clave BYOK>",
 *     model: "<modelo claude, opcional>",
 *     groqModel: "<modelo groq texto, opcional>",
 *     entry: { text, time: "HH:MM", level: 1-5|null, symptoms: ["hinchazón", …] },
 *     meals: [{ ref: "m1", h: 3.5, time: "HH:MM", d, food, comps, ings, summary }],
 *     suspects: ["gluten", …] (opcional: componentes que ya coincidieron con molestias),
 *     validIngredients: ["lactosa", …] (opcional) }
 *
 *   200 { ok: true, provider, action: "diary", result } con result =
 *       { summary, causes: [{ ref, components, ingredients, likelihood, reason }], advice, urgent }
 *   4xx/5xx { ok: false, kind, message } con la taxonomía de /api/analyze:
 *       auth | network | badjson | ratelimit | badrequest | server | notimpl | unknown.
 *
 * Privacidad: igual que /api/analyze. La clave solo firma la llamada al
 * proveedor: no se guarda, no se registra en logs y no se devuelve.
 * Las comidas llegan resumidas por el cliente (sin fotos ni ids internos).
 */

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

// Debe coincidir con ONSET_WINDOWS en js/data.js (lo comprueba tests/diary.test.mjs).
const WINDOWS = {
  lactosa: [0.5, 2], gluten: [1, 48], fructosa: [1, 4], huevo: [1, 6], frutosSecos: [0.25, 2],
  soja: [1, 6], picante: [0.5, 3], alcohol: [1, 12], cafeina: [0.5, 6], histamina: [0.5, 2],
};
const FALLBACK_INGREDIENTS = Object.keys(WINDOWS);

const LIMITS = {
  text: 1500, symptom: 24, symptoms: 8, meals: 12, d: 140, food: 120, comp: 60, comps: 6, summaryIn: 300,
  summary: 800, causes: 3, reason: 400, advice: 500,
};

// Sin tope propio (lección del #17): el thinking adaptativo de la familia 5
// cuenta contra max_tokens, así que se pide el máximo de salida del modelo.
const CLAUDE_MAX_OUTPUT_FALLBACK = 32000;
function claudeMaxOutput(model) {
  const m = String(model || "").toLowerCase();
  if (/^claude-(opus-4-[678]|(opus|sonnet|haiku)-5|fable|mythos)/.test(m)) return 128000;
  return 64000;
}
const GROQ_RETRY_MAX_TOKENS = 8192;
const CLAUDE_RATELIMIT_MAX_TOKENS = 16000;

function clip(s, n) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// ---- Entrada (llega ya resumida del cliente; aquí solo se sanea) ----
function sanitize(body, validKeys) {
  const keyOk = (x) => typeof x === "string" && validKeys.includes(x);
  const strs = (v, n, max) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string")
    .map((x) => clip(x, n)).filter(Boolean).slice(0, max);
  const e = body && typeof body.entry === "object" && body.entry ? body.entry : {};
  const level = Number(e.level);
  const entry = {
    text: clip(e.text, LIMITS.text),
    time: HHMM.test(String(e.time || "")) ? String(e.time) : "",
    level: Number.isInteger(level) && level >= 1 && level <= 5 ? level : null,
    symptoms: strs(e.symptoms, LIMITS.symptom, LIMITS.symptoms),
  };
  const seen = new Set();
  const meals = (Array.isArray(body && body.meals) ? body.meals : [])
    .filter((m) => m && /^m\d{1,2}$/.test(String(m.ref)) && !seen.has(m.ref) && seen.add(m.ref))
    .slice(0, LIMITS.meals)
    .map((m) => ({
      ref: String(m.ref),
      h: isFinite(Number(m.h)) ? Math.max(0, Math.min(48, Math.round(Number(m.h) * 10) / 10)) : null,
      time: HHMM.test(String(m.time || "")) ? String(m.time) : "",
      d: clip(m.d, LIMITS.d),
      food: clip(m.food, LIMITS.food),
      comps: strs(m.comps, LIMITS.comp, LIMITS.comps),
      ings: Array.isArray(m.ings) ? [...new Set(m.ings.filter(keyOk))].slice(0, 10) : [],
      summary: clip(m.summary, LIMITS.summaryIn),
    }));
  const suspects = Array.isArray(body && body.suspects) ? [...new Set(body.suspects.filter(keyOk))].slice(0, 6) : [];
  return { entry, meals, suspects };
}

function windowsText(validKeys) {
  return validKeys.filter((k) => WINDOWS[k]).map((k) => `${k} ${WINDOWS[k][0]}-${WINDOWS[k][1]} h`).join(", ");
}

function diaryPrompt(input, validKeys) {
  const { entry, meals, suspects } = input;
  const lines = [
    "Eres un asistente de diario alimentario personal. NO eres medico y NO diagnosticas. " +
    "El usuario cuenta como se siente; cruzalo con lo que comio en las 24 h anteriores e identifica " +
    "las posibles causas alimentarias, teniendo en cuenta el tiempo transcurrido desde cada comida y " +
    "las ventanas tipicas de aparicion (orientativas): " + windowsText(validKeys) + ". " +
    "Si ninguna comida encaja, dilo con claridad y no inventes causas. " +
    "Si el texto describe senales de alarma (sangre, dificultad para respirar, hinchazon de labios, lengua o garganta, " +
    "desmayo, fiebre alta, dolor intenso), pon urgent a true y recomienda atencion medica inmediata en advice. " +
    "Responde UNICAMENTE con un objeto JSON, sin texto antes o despues y sin bloques markdown. " +
    'Forma exacta: {"summary": "<2-3 frases cercanas: que puede estar pasando>", ' +
    '"causes": [{"ref": "<ref de la comida, ej. m1>", "components": ["<componente sospechoso, ej. queso>"], ' +
    '"ingredients": [<claves de: ' + validKeys.join(", ") + '>], "likelihood": "alta|media|baja", ' +
    '"reason": "<por que encaja: tiempo transcurrido y sintomas>"}], ' +
    '"advice": "<1-2 frases: que observar o probar>", "urgent": false}. ' +
    "Maximo " + LIMITS.causes + " causas, de mas a menos probable, usando solo refs de la lista (causes vacio si nada encaja). " +
    "Usa comillas dobles y sin comas finales, para que sea JSON.parse valido.",
    "",
    `Entrada del diario${entry.time ? " (" + entry.time + ")" : ""}: ${entry.text}`,
    `Nivel de bienestar: ${entry.level == null ? "no indicado" : entry.level + "/5"}.` +
      (entry.symptoms.length ? ` Sintomas detectados: ${entry.symptoms.join(", ")}.` : ""),
  ];
  if (suspects.length) lines.push("Componentes que ya coincidieron con molestias otras veces: " + suspects.join(", ") + ".");
  if (meals.length) {
    lines.push("Comidas de las 24 h anteriores (ref | hace cuanto | descripcion | alimento detectado | componentes | claves | analisis):");
    for (const m of meals) {
      lines.push(`- ${m.ref} | ${m.h == null ? "?" : m.h + " h"}${m.time ? " (" + m.time + ")" : ""} | ${m.d || "-"} | ` +
        `${m.food || "-"} | ${m.comps.join(", ") || "-"} | ${m.ings.join(", ") || "-"} | ${m.summary || "-"}`);
    }
  } else {
    lines.push("No hay comidas registradas en las 24 h anteriores.");
  }
  return lines.join("\n");
}

// ---- Parseo robusto (réplica mínima del de functions/api/analyze.js) ----
function stripFences(text) {
  const s = String(text || "");
  const inner = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(s))) inner.push(m[1]);
  if (inner.length) return inner.join("\n");
  return s.replace(/```/g, " ");
}

function balancedCandidates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false;
    let closed = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { out.push(text.slice(start, j + 1)); i = j + 1; closed = true; break; }
      }
    }
    if (!closed) break;
  }
  return out;
}

function repairJson(text) {
  return String(text).replace(/,(\s*[}\]])/g, "$1").replace(/;\s*$/, "");
}

function tryParseOne(candidate) {
  try { return JSON.parse(candidate); } catch { /* sigue */ }
  try { return JSON.parse(repairJson(candidate)); } catch { /* sigue */ }
  return null;
}

function normalizeLikelihood(v) {
  const t = String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/alta|high|probable/.test(t) && !/poco|improbable/.test(t)) return "alta";
  if (/media|medium|moderad|posible/.test(t)) return "media";
  return "baja";
}

function normalizeDiary(obj, refs, validKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const strs = (v, n, max) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string")
    .map((x) => clip(x, n)).filter(Boolean).slice(0, max);
  const seen = new Set();
  const causes = (Array.isArray(obj.causes) ? obj.causes : [])
    .filter((c) => c && typeof c === "object" && refs.includes(String(c.ref)) && !seen.has(String(c.ref)) && seen.add(String(c.ref)))
    .slice(0, LIMITS.causes)
    .map((c) => ({
      ref: String(c.ref),
      components: strs(c.components, LIMITS.comp, LIMITS.comps),
      ingredients: [...new Set((Array.isArray(c.ingredients) ? c.ingredients : []).filter((x) => typeof x === "string" && validKeys.includes(x)))],
      likelihood: normalizeLikelihood(c.likelihood),
      reason: clip(c.reason, LIMITS.reason),
    }));
  const summary = clip(obj.summary || obj.resumen, LIMITS.summary);
  if (!summary && !causes.length) return null;
  return {
    summary: summary || "Posibles causas según lo que comiste en las 24 h anteriores.",
    causes,
    advice: clip(obj.advice || obj.consejo, LIMITS.advice),
    urgent: obj.urgent === true || obj.urgent === "true",
  };
}

function parseDiaryJson(text, providerLabel, refs, validKeys, diag) {
  const raw = String(text || "");
  const extra = diag ? ` (${diag})` : "";
  const cut = /max_tokens|length/i.test(diag || "") ? " Se cortó por límite de longitud: pulsa de nuevo." : "";
  if (!raw.trim()) return { error: `${providerLabel} devolvió una respuesta vacía${extra}.${cut}` };
  const defenced = stripFences(raw);
  let obj = tryParseOne(defenced.trim());
  if (!obj) {
    for (const cand of balancedCandidates(defenced)) {
      obj = tryParseOne(cand.trim());
      if (obj) break;
    }
  }
  const out = obj && normalizeDiary(obj, refs, validKeys);
  if (!out) return { error: `${providerLabel} respondió pero no en el formato esperado${extra}.${cut}` };
  return { result: out };
}

function diagClaude(data) {
  const blocks = Array.isArray(data.content) ? data.content.map((b) => (b && b.type) || "?").slice(0, 8) : [];
  const stop = data.stop_reason || "?";
  const u = data.usage || null;
  const th = u && u.output_tokens_details && u.output_tokens_details.thinking_tokens;
  const use = u ? `${u.input_tokens || 0}→${u.output_tokens || 0}${th ? ` (thinking ${th})` : ""}` : "?";
  const ateBudget = stop === "max_tokens" && blocks.includes("thinking")
    ? ", el razonamiento interno del modelo agotó el límite" : "";
  return `stop=${stop}, bloques=[${blocks.join(",") || "ninguno"}], uso=${use}${ateBudget}`;
}

// Misma tabla que functions/api/diet.js (doc de Anthropic, oct-2026).
function claudeThinking(model) {
  const m = String(model || "").toLowerCase();
  if (/^claude-sonnet-5-5(-\d{8})?$/.test(m)) {
    return { thinking: { type: "between_tools" }, output_config: { effort: "low" } };
  }
  if (/^claude-(sonnet-5|opus-5|haiku-5-5)(-\d{8})?$/.test(m)) {
    return { thinking: { type: "disabled" }, output_config: { effort: "low" } };
  }
  if (/^claude-(opus-5-5|fable|mythos)/.test(m)) return { output_config: { effort: "low" } };
  if (/^claude-(3|(opus|sonnet|haiku)-4)/.test(m)) return {};
  return { output_config: { effort: "low" } };
}

async function claudeFetch(key, body) {
  const send = (b) => fetch(CLAUDE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(b),
  });
  let current = body;
  let res = await send(current);
  for (let i = 0; i < 2 && res.status === 400; i++) {
    const t = await res.clone().text().catch(() => "");
    const next = { ...current };
    if (/max_tokens/i.test(t) && current.max_tokens > CLAUDE_MAX_OUTPUT_FALLBACK) {
      const allowed = Number((/(\d{4,6})\D{0,40}maximum/i.exec(t) || [])[1]);
      next.max_tokens = allowed && allowed < current.max_tokens ? allowed : CLAUDE_MAX_OUTPUT_FALLBACK;
    } else if (/thinking|effort|output_config/i.test(t) && (current.thinking || current.output_config)) {
      delete next.thinking;
      delete next.output_config;
    } else break;
    current = next;
    res = await send(current);
  }
  if (res.status === 429 && current.max_tokens > CLAUDE_RATELIMIT_MAX_TOKENS) {
    const t = await res.clone().text().catch(() => "");
    if (/output.?tokens/i.test(t)) res = await send({ ...current, max_tokens: CLAUDE_RATELIMIT_MAX_TOKENS });
  }
  return { res };
}

function claudeText(data) {
  return (Array.isArray(data.content) ? data.content : [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
}

function diagGroq(data) {
  const c = data.choices && data.choices[0];
  const use = data.usage ? `${data.usage.prompt_tokens || 0}→${data.usage.completion_tokens || 0}` : "?";
  return `finish=${(c && c.finish_reason) || "?"}, uso=${use}`;
}

async function readUpstreamJson(res, providerLabel) {
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text().catch(() => "");
  if (!/json/i.test(ctype)) {
    return { error: `${providerLabel} devolvió un 200 no-JSON (${(ctype || "sin content-type").slice(0, 60)}).` };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: `${providerLabel} devolvió un JSON ilegible (${text.length} caracteres).` };
  }
}

// ---- Respuestas ----
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function fail(kind, message, status) {
  return json({ ok: false, kind, message }, status || 400);
}

const RETRY = " Pulsa «Reanalizar» en la entrada; el análisis local sigue disponible.";

function upstreamError(providerLabel, status, bodyText, statusText) {
  const head = (bodyText || "").slice(0, 200) || statusText || ("HTTP " + status);
  if (status === 401 || status === 403) {
    return fail("auth",
      `${providerLabel} rechazó la clave (HTTP ${status}). Revisa que la pegaste ` +
      `completa en Ajustes y que no caducó. Detalle: ${head}`, status);
  }
  if (status === 429) {
    return fail("ratelimit",
      `${providerLabel} dice que hay demasiadas peticiones o sin cuota (HTTP 429). ` +
      `Espera unos minutos o revisa tu plan/límites. Detalle: ${head}`, 429);
  }
  if (status === 400) {
    return fail("badrequest", `${providerLabel} rechazó la petición (HTTP 400): revisa el modelo en Ajustes. Detalle: ${head}`, 400);
  }
  if (status >= 500) {
    return fail("server", `${providerLabel} falla en su lado (HTTP ${status}). Reintenta en unos minutos. Detalle: ${head}`, 502);
  }
  return fail("unknown", `${providerLabel} ${status}: ${head}`, status);
}

// ---- Proveedores ----
async function claudeCall({ key, model, input, refs, validKeys }) {
  const m = model || DEFAULT_CLAUDE_MODEL;
  let res;
  try {
    ({ res } = await claudeFetch(key, {
      model: m,
      max_tokens: claudeMaxOutput(m),
      ...claudeThinking(m),
      messages: [{ role: "user", content: diaryPrompt(input, validKeys) }],
    }));
  } catch {
    return fail("network", "No se pudo contactar con Claude desde el proxy (red). Reintenta en unos minutos.", 502);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return upstreamError("Claude", res.status, t, res.statusText);
  }
  const read = await readUpstreamJson(res, "Claude");
  if (read.error) return fail("badjson", read.error + RETRY, 502);
  const parsed = parseDiaryJson(claudeText(read.data), "Claude", refs, validKeys, diagClaude(read.data));
  if (parsed.error) return fail("badjson", parsed.error + RETRY, 502);
  return json({ ok: true, provider: "claude", action: "diary", result: parsed.result });
}

async function groqCall({ key, groqModel, input, refs, validKeys }) {
  const body = {
    model: groqModel || DEFAULT_GROQ_MODEL,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Respondes SOLO con JSON válido, sin texto adicional." },
      { role: "user", content: diaryPrompt(input, validKeys) },
    ],
  };
  const send = (b) => fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(b),
  });
  let res;
  try {
    res = await send(body);
    if (res.status === 413 || res.status === 429) {
      const t = await res.clone().text().catch(() => "");
      if (/too large|tokens per minute|tpm/i.test(t)) res = await send({ ...body, max_tokens: GROQ_RETRY_MAX_TOKENS });
    }
  } catch {
    return fail("network", "No se pudo contactar con Groq desde el proxy (red). Reintenta en unos minutos.", 502);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return upstreamError("Groq", res.status, t, res.statusText);
  }
  const read = await readUpstreamJson(res, "Groq");
  if (read.error) return fail("badjson", read.error + RETRY, 502);
  const c = read.data.choices && read.data.choices[0];
  const parsed = parseDiaryJson((c && c.message && c.message.content) || "", "Groq", refs, validKeys, diagGroq(read.data));
  if (parsed.error) return fail("badjson", parsed.error + RETRY, 502);
  return json({ ok: true, provider: "groq", action: "diary", result: parsed.result });
}

// ---- Entrada Pages Functions ----
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  if (request.method === "GET") {
    return json({ ok: true, service: "diary-proxy", providers: ["claude", "groq"], windowHours: 24 });
  }
  if (request.method !== "POST") {
    return fail("badrequest", "Usa POST con { provider, key, entry, meals }.", 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("badrequest", "El cuerpo debe ser JSON con { provider, key, entry, meals }.", 400);
  }

  const provider = String((body && body.provider) || "").toLowerCase();
  const key = String((body && body.key) || "").trim();

  if (!["claude", "groq", "hermes", "cursor"].includes(provider)) {
    return fail("badrequest", "Proveedor desconocido: usa claude, groq, hermes o cursor.", 400);
  }
  if (!key) {
    return fail("auth", "Falta la clave BYOK (viaja solo en esta petición, no se guarda). Pégala en Ajustes.", 401);
  }
  if (provider === "hermes" || provider === "cursor") {
    const label = provider === "hermes" ? "Hermes" : "Cursor";
    return fail("notimpl", `Proveedor ${label} aún no implementado.`, 501);
  }

  const validKeys = Array.isArray(body.validIngredients) && body.validIngredients.length
    ? body.validIngredients.filter((x) => typeof x === "string")
    : FALLBACK_INGREDIENTS;
  const input = sanitize(body, validKeys);
  if (!input.entry.text) {
    return fail("badrequest", "Falta el texto del diario: cuenta cómo te sientes.", 400);
  }

  const args = {
    key,
    model: String(body.model || "").trim(),
    groqModel: String(body.groqModel || "").trim(),
    input,
    refs: input.meals.map((m) => m.ref),
    validKeys,
  };

  // Sin console.log del body ni de la key.
  try {
    if (provider === "claude") return await claudeCall(args);
    return await groqCall(args);
  } catch {
    return fail("unknown", "El proxy falló de forma inesperada. Reintenta; el análisis local sigue disponible.", 500);
  }
}
