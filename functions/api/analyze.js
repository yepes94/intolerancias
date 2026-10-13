/* Intolerancias · functions/api/analyze.js
 *
 * Proxy BYOK "Analizar con IA" en Cloudflare Pages Functions.
 *
 * Por qué existe: llamar directo desde el navegador a api.anthropic.com /
 * api.groq.com exige cabeceras CORS especiales y expone la clave a
 * bloqueadores/extensiones. Con este proxy same-origin (`/api/analyze`) el
 * navegador solo habla con la propia app y el CORS desaparece.
 *
 * Contrato:
 *   POST /api/analyze
 *   { provider: "claude"|"groq"|"hermes"|"cursor",
 *     action: "analyze"|"ping" (defecto "analyze"),
 *     key: "<clave BYOK>",
 *     model: "<modelo claude, opcional>",
 *     groqModel: "<modelo groq texto, opcional>",
 *     description: "<texto comida>",
 *     imageDataUrl: "<data:image/…;base64,…>" | null,
 *     validIngredients: ["lactosa", …] (opcional; si falta se usa la lista
 *       de respaldo de abajo, que debe coincidir con js/data.js) }
 *
 *   200 { ok: true, provider, action, result } donde result es
 *       { ingredients, summary, checkinQuestion } (analyze) o "ok" (ping).
 *   4xx/5xx { ok: false, kind, message } con la misma taxonomía que el
 *       frontend (js/providers.js): auth | network | badjson | ratelimit |
 *       badrequest | server | notimpl | unknown.
 *
 * Privacidad (importante):
 * - La clave viaja SOLO en el cuerpo de la petición y se usa para firmar la
 *   llamada al proveedor. NUNCA se guarda (sin KV/D1/variables), NUNCA se
 *   escribe en logs y NUNCA se devuelve en la respuesta.
 * - `Cache-Control: no-store` en todas las respuestas para que nada se
 *   cachee con la clave dentro.
 *
 * Sin P-Stack: solo Pages Functions estándar, sin servicios extra.
 */

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Respaldo si el frontend no envía validIngredients. Debe coincidir con
// ONSET_WINDOWS en js/data.js (solo se usa para redactar el prompt y filtrar).
const FALLBACK_INGREDIENTS = [
  "lactosa", "gluten", "fructosa", "huevo", "frutosSecos",
  "soja", "picante", "alcohol", "cafeina", "histamina",
];

function foodPrompt(description, hasImage, validKeys) {
  const keys = (validKeys && validKeys.length ? validKeys : FALLBACK_INGREDIENTS).join(", ");
  return (
    "Eres un asistente de diario alimentario personal. NO eres medico y NO diagnosticas. " +
    "Analiza esta comida y responde UNICAMENTE con un objeto JSON, sin nada mas: " +
    "ni saludos, ni explicaciones antes o despues, ni bloques markdown (nada de ```), solo el objeto. " +
    "Se conciso: la respuesta completa debe ser corta (menos de ~250 palabras en total). " +
    'Forma exacta: {"food": "<alimento detectado en 2-5 palabras, ej. pan blanco de molde>", ' +
    '"components": ["<solo los componentes relevantes que causan intolerancia/alergia, " + ' +
    'máx. 6, ej. gluten, trigo, fructanos, soja, posible lactosa>"], ' +
    '"ingredients": [<solo las claves relevantes de: ' + keys + "> que correspondan a esos componentes], " +
    '"summary": "<1 frase corta, máx. 280 caracteres, tono cercano: que vigilar y por que>", ' +
    '"checkinQuestion": "<pregunta corta tipo como te sientes>"}. ' +
    "Si es un producto concreto, identifica sus componentes típicos " +
    "(ej. pan blanco de molde → gluten, trigo, fructanos, soja, posible lactosa) " +
    "y quédate solo con los relevantes para esta comida. " +
    "Usa comillas dobles y sin comas finales, para que sea JSON.parse valido. " +
    "Comida: " + (description || "(solo foto)") + (hasImage ? " [incluye foto]" : "") +
    "\nRecuerda: anade que es orientativo y no sustituye una prueba medica real."
  );
}

// ---- Parseo robusto (réplica mínima del de js/providers.js) ----
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
  if (!candidate.includes('"') && candidate.includes("'")) {
    const swapped = candidate.replace(/'/g, '"');
    try { return JSON.parse(swapped); } catch { /* sigue */ }
    try { return JSON.parse(repairJson(swapped)); } catch { /* sigue */ }
  }
  return null;
}

function normalizeAnalysis(obj, validKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const valid = validKeys && validKeys.length ? validKeys : FALLBACK_INGREDIENTS;
  const ingredients = Array.isArray(obj.ingredients)
    ? obj.ingredients.filter((x) => typeof x === "string" && valid.includes(x.trim())).map((x) => x.trim())
    : (typeof obj.ingredients === "string"
      ? obj.ingredients.split(/[,;|\n]/).map((x) => x.trim()).filter((x) => valid.includes(x))
      : []);
  const seen = new Set();
  const dedup = ingredients.filter((x) => !seen.has(x) && (seen.add(x), true));
  const summary = typeof obj.summary === "string" ? obj.summary.trim()
    : (typeof obj.resumen === "string" ? obj.resumen.trim() : "");
  const checkinQuestion = typeof obj.checkinQuestion === "string" ? obj.checkinQuestion.trim()
    : (typeof obj.pregunta === "string" ? obj.pregunta.trim() : "");
  if (!summary && !dedup.length && !checkinQuestion) return null;
  // Campos aditivos (opcionales): el alimento detectado y sus componentes.
  // Son informativos: `ingredients` sigue siendo la única lista taxonómica
  // (la que programa check-ins). Se topan por longitud/cantidad para que la
  // respuesta quepa holgada en max_tokens. Clientes viejos los ignoran.
  const food = typeof obj.food === "string" ? obj.food.trim().slice(0, 120) : "";
  const components = Array.isArray(obj.components)
    ? obj.components.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 6)
    : [];
  return {
    ingredients: dedup,
    summary: summary.length > 280 ? summary.slice(0, 277).trimEnd() + "…" : (summary || "La IA no dio detalles; vigila cómo te sientes en las próximas horas."),
    checkinQuestion: checkinQuestion || "¿Cómo te sientes?",
    ...(food ? { food } : {}),
    ...(components.length ? { components } : {}),
  };
}

function parseAnalysisJson(text, providerLabel, validKeys, diag) {
  const raw = String(text || "");
  const extra = diag ? ` (${diag})` : "";
  if (!raw.trim()) {
    const cut = /max_tokens|length/i.test(diag || "")
      ? " Se cortó por límite de longitud: pulsa de nuevo."
      : "";
    return { error: { kind: "badjson", message: `${providerLabel} devolvió una respuesta vacía${extra}.${cut}` } };
  }
  const defenced = stripFences(raw);
  let obj = tryParseOne(defenced.trim());
  if (!obj) {
    for (const cand of balancedCandidates(defenced)) {
      obj = tryParseOne(cand.trim());
      if (obj) break;
    }
  }
  const norm = obj && normalizeAnalysis(obj, validKeys);
  if (!norm) {
    const cut = /max_tokens|length/i.test(diag || "")
      ? " Se cortó por límite de longitud: pulsa de nuevo."
      : "";
    return { error: { kind: "badjson", message: `${providerLabel} respondió pero no en el formato esperado${extra}.${cut}` } };
  }
  return { result: norm };
}

// Diagnóstico sin contenido sensible: stop reason, tipos de bloque y uso.
// Sirve para distinguir "modelo mudo" de "respuesta cortada" sin guardar nada.
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

// Thinking según la doc de Anthropic (oct-2026): en la familia 5 el thinking
// adaptativo viene activo sin pedirlo y cuenta contra max_tokens, así que un
// tope pensado solo para el JSON se agota antes de escribir el texto.
// Se apaga donde el modelo lo admite; donde no, se baja effort a "low".
// Los 4.x tienen el thinking apagado por defecto y algunos rechazan effort.
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

// Un modelo que no conocemos puede rechazar thinking/effort con 400: se
// reintenta una vez sin esos campos antes de dar el error.
async function claudeFetch(key, body) {
  const send = (b) => fetch(CLAUDE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(b),
  });
  const res = await send(body);
  if (res.status !== 400 || !(body.thinking || body.output_config)) return { res };
  const t = await res.clone().text().catch(() => "");
  if (!/thinking|effort|output_config/i.test(t)) return { res };
  const plain = { ...body };
  delete plain.thinking;
  delete plain.output_config;
  return { res: await send(plain) };
}

function claudeText(data) {
  return (Array.isArray(data.content) ? data.content : [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
}

function diagGroq(data) {
  const c = data.choices && data.choices[0];
  const finish = (c && c.finish_reason) || "?";
  const use = data.usage ? `${data.usage.prompt_tokens || 0}→${data.usage.completion_tokens || 0}` : "?";
  return `finish=${finish}, uso=${use}`;
}

// Lee el JSON del proveedor exigiendo cuerpo JSON real: un 200 no-JSON antes
// se tragaba en silencio y acababa en "respuesta vacía" sin explicación.
async function readUpstreamJson(res, providerLabel) {
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text().catch(() => "");
  if (!/json/i.test(ctype)) {
    return { error: { kind: "badjson", message: `${providerLabel} devolvió un 200 no-JSON (${(ctype || "sin content-type").slice(0, 60)}).` } };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: { kind: "badjson", message: `${providerLabel} devolvió un JSON ilegible (${text.length} caracteres).` } };
  }
}

// Valida la foto ANTES de reenviarla: un dataURL roto o gigante provocaba
// respuestas de error/vacías difíciles de atribuir. Límite ~4,5 MB decodificados
// (Anthropic admite 5 MB por imagen).
function parseImageDataUrl(s) {
  if (s == null || s === "") return { none: true };
  const m = String(s).match(/^data:(image\/[\w+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !m[2]) {
    return { error: "La foto no llegó al proxy en formato válido. Reintenta; sin foto también funciona." };
  }
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > 4.5 * 1024 * 1024) {
    return { error: "La foto es demasiado grande para el proveedor. Prueba sin foto o con una imagen menor." };
  }
  return { mediaType: m[1].toLowerCase(), data: m[2] };
}

// ---- Respuestas ----
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(kind, message, status) {
  return json({ ok: false, kind, message }, status || 400);
}

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
    return fail("badrequest",
      `${providerLabel} rechazó la petición (HTTP 400): revisa el modelo en Ajustes ` +
      `o quita la foto si el modelo no tiene visión. Detalle: ${head}`, 400);
  }
  if (status >= 500) {
    return fail("server",
      `${providerLabel} falla en su lado (HTTP ${status}). Reintenta en unos minutos; ` +
      `el análisis local sigue funcionando. Detalle: ${head}`, 502);
  }
  return fail("unknown", `${providerLabel} ${status}: ${head}`, status);
}

// ---- Proveedores (lado servidor) ----
async function claudeCall({ action, key, model, description, imageDataUrl, validKeys }) {
  const img = parseImageDataUrl(imageDataUrl);
  if (img.error) return fail("badrequest", img.error, 400);
  const m = model || DEFAULT_CLAUDE_MODEL;
  // max_tokens deja margen al thinking que no se pueda apagar; el JSON en sí
  // cabe en ~400 tokens gracias a los topes del prompt.
  const body = action === "ping"
    ? { model: m, max_tokens: 64, ...claudeThinking(m), messages: [{ role: "user", content: "Responde solo: ok" }] }
    : { model: m, max_tokens: 2500, ...claudeThinking(m), messages: [{ role: "user", content: claudeContent(description, img) }] };
  let res;
  try {
    ({ res } = await claudeFetch(key, body));
  } catch {
    return fail("network", "No se pudo contactar con Claude desde el proxy (red). Reintenta en unos minutos.", 502);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return upstreamError("Claude", res.status, t, res.statusText);
  }
  if (action === "ping") return json({ ok: true, provider: "claude", action: "ping", result: "ok" });
  const read = await readUpstreamJson(res, "Claude");
  if (read.error) return fail("badjson", read.error.message + " Pulsa de nuevo «Analizar con IA».", 502);
  const text = claudeText(read.data);
  const parsed = parseAnalysisJson(text, "Claude", validKeys, diagClaude(read.data));
  if (parsed.error) return fail("badjson", parsed.error.message + " Pulsa de nuevo «Analizar con IA».", 502);
  return json({ ok: true, provider: "claude", action: "analyze", result: parsed.result });
}

function claudeContent(description, img) {
  const content = [];
  if (img && !img.none) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  content.push({ type: "text", text: foodPrompt(description, !!(img && !img.none)) });
  return content;
}

async function groqCall({ action, key, groqModel, description, imageDataUrl, validKeys }) {
  if (action === "ping") {
    let res;
    try {
      res = await fetch(GROQ_MODELS_URL, { headers: { authorization: "Bearer " + key } });
    } catch {
      return fail("network", "No se pudo contactar con Groq desde el proxy (red). Reintenta en unos minutos.", 502);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return upstreamError("Groq", res.status, t, res.statusText);
    }
    return json({ ok: true, provider: "groq", action: "ping", result: "ok" });
  }
  const hasImage = !!imageDataUrl;
  const img = parseImageDataUrl(imageDataUrl);
  if (img.error) return fail("badrequest", img.error, 400);
  const model = hasImage ? DEFAULT_GROQ_VISION_MODEL : (groqModel || DEFAULT_GROQ_MODEL);
  const content = [];
  if (hasImage) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
  content.push({ type: "text", text: foodPrompt(description, hasImage, validKeys) });
  let res;
  try {
    res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Respondes SOLO con JSON válido, sin texto adicional." },
          { role: "user", content },
        ],
      }),
    });
  } catch {
    return fail("network", "No se pudo contactar con Groq desde el proxy (red). Reintenta en unos minutos.", 502);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return upstreamError("Groq", res.status, t, res.statusText);
  }
  const data = await readUpstreamJson(res, "Groq");
  if (data.error) return fail("badjson", data.error.message + " Pulsa de nuevo «Analizar con IA».", 502);
  const text = (data.data.choices && data.data.choices[0] && data.data.choices[0].message && data.data.choices[0].message.content) || "";
  const parsed = parseAnalysisJson(text, "Groq", validKeys, diagGroq(data.data));
  if (parsed.error) return fail("badjson", parsed.error.message + " Pulsa de nuevo «Analizar con IA».", 502);
  return json({ ok: true, provider: "groq", action: "analyze", result: parsed.result });
}

// ---- Entrada Pages Functions ----
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  if (request.method === "GET") {
    // Salud de la ruta (sin clave): útil para verificar el deploy en preview.
    return json({ ok: true, service: "analyze-proxy", providers: ["claude", "groq"] });
  }

  if (request.method !== "POST") {
    return fail("badrequest", "Usa POST con { provider, key, … }.", 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("badrequest", "El cuerpo debe ser JSON con { provider, action, key, … }.", 400);
  }

  const provider = String((body && body.provider) || "").toLowerCase();
  const action = String((body && body.action) || "analyze").toLowerCase();
  const key = String((body && body.key) || "").trim();

  if (!["claude", "groq", "hermes", "cursor"].includes(provider)) {
    return fail("badrequest", "Proveedor desconocido: usa claude, groq, hermes o cursor.", 400);
  }
  if (!["analyze", "ping"].includes(action)) {
    return fail("badrequest", "Acción desconocida: usa analyze o ping.", 400);
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

  const args = {
    action,
    key,
    model: String(body.model || "").trim(),
    groqModel: String(body.groqModel || "").trim(),
    description: String(body.description || ""),
    imageDataUrl: body.imageDataUrl || null,
    validKeys,
  };

  // Nota: sin console.log del body ni de la key. Solo errores genéricos
  // (proveedor + acción + estado) para no filtrar nada sensible.
  try {
    if (provider === "claude") return await claudeCall(args);
    return await groqCall(args);
  } catch (err) {
    return fail("unknown", "El proxy falló de forma inesperada. Reintenta; el análisis local sigue funcionando.", 500);
  }
}
