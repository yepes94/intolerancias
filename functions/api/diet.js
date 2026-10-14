/* Intolerancias · functions/api/diet.js
 *
 * Proxy BYOK "Dieta de prueba con IA" (hermano de /api/analyze).
 *
 * Contrato:
 *   POST /api/diet
 *   { provider: "claude"|"groq"|"hermes"|"cursor",
 *     key: "<clave BYOK>",
 *     model: "<modelo claude, opcional>",
 *     groqModel: "<modelo groq texto, opcional>",
 *     scope: "day"|"meal",
 *     slot: "desayuno"|"comida"|"merienda"|"cena" (solo scope "meal"),
 *     context: { avoid: ["gluten", …], suspects: [{ id, n, bad, symptoms }],
 *                recent: [{ d, ings, comps, f, s }], baseline,
 *                bowel: { days, counts: [n por tipo de Bristol 1-7], pain, urgency, blood } (opcional),
 *                wellbeing: { days, avgMood, avgSleepH, avgSleepQ, lowSleepDays, stressDays,
 *                             lowMoodDays, tags: ["estres", …], factors: [{ id, badWith, withN }] } },
 *       (wellbeing, opcional: ánimo y sueño de los últimos 7 días, como factor de contexto)
 *     validIngredients: ["lactosa", …] (opcional) }
 *
 *   200 { ok: true, provider, action: "plan", result } con result =
 *       { mode, avoid, rationale, meals: [{ slot, name, items, why }], tips }
 *   4xx/5xx { ok: false, kind, message } con la taxonomía de /api/analyze:
 *       auth | network | badjson | ratelimit | badrequest | server | notimpl | unknown.
 *
 * Privacidad: igual que /api/analyze. La clave solo firma la llamada al
 * proveedor: no se guarda, no se registra en logs y no se devuelve.
 * El contexto llega ya resumido y acotado por el cliente (sin fotos).
 */

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

const FALLBACK_INGREDIENTS = [
  "lactosa", "gluten", "fructosa", "huevo", "frutosSecos",
  "soja", "picante", "alcohol", "cafeina", "histamina",
];

const SLOTS = ["desayuno", "comida", "merienda", "cena"];

// Topes de saneado (no de tokens): protegen la UI y el localStorage de
// respuestas desbocadas sin recortar un plan bien explicado.
const LIMITS = {
  name: 120, item: 120, items: 12, step: 300, steps: 8, why: 500, swap: 300, watch: 300,
  rationale: 800, tip: 300, tips: 6, recent: 15,
};
// Sin tope propio para la dieta: la API de Claude exige max_tokens, así que
// se pide el máximo de salida del modelo (doc de modelos, oct-2026).
const CLAUDE_MAX_OUTPUT_FALLBACK = 32000;
function claudeMaxOutput(model) {
  const m = String(model || "").toLowerCase();
  if (/^claude-(opus-4-[678]|(opus|sonnet|haiku)-5|fable|mythos)/.test(m)) return 128000;
  return 64000;
}
// Groq: sin max_tokens usa el máximo del modelo, pero en el plan gratuito
// puede rechazar la petición por cuota de tokens/minuto; entonces se reintenta con este.
const GROQ_RETRY_MAX_TOKENS = 8192;

function clip(s, n) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

// ---- Contexto (lo envía el cliente ya resumido; aquí solo se sanea) ----
const WELLBEING_TAGS = {
  estres: "estres", cansancio: "cansancio", ansiedad: "ansiedad", tristeza: "tristeza",
  irritable: "irritabilidad", energia: "energia", calma: "calma", motivacion: "motivacion",
};
const WELLBEING_FACTORS = { pocoSueno: "dormir poco", estres: "estres o ansiedad", animoBajo: "animo bajo" };

function sanitizeWellbeing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v, min, max, dec) => {
    if (v == null || !isFinite(Number(v))) return null;
    const k = Math.pow(10, dec);
    return Math.round(Math.max(min, Math.min(max, Number(v))) * k) / k;
  };
  const cnt = (v) => num(v, 0, 7, 0) || 0;
  const w = {
    days: cnt(raw.days),
    avgMood: num(raw.avgMood, 1, 5, 1),
    avgSleepH: num(raw.avgSleepH, 0, 16, 1),
    avgSleepQ: num(raw.avgSleepQ, 1, 5, 1),
    lowSleepDays: cnt(raw.lowSleepDays),
    stressDays: cnt(raw.stressDays),
    lowMoodDays: cnt(raw.lowMoodDays),
    tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).filter((t) => typeof t === "string" && WELLBEING_TAGS[t]))].slice(0, 4),
    factors: (Array.isArray(raw.factors) ? raw.factors : [])
      .filter((f) => f && typeof f.id === "string" && WELLBEING_FACTORS[f.id]).slice(0, 3)
      .map((f) => ({ id: f.id, badWith: cnt(f.badWith), withN: Math.max(cnt(f.withN), cnt(f.badWith)) })),
  };
  return w.days ? w : null;
}

function sanitizeContext(raw, validKeys) {
  const c = raw && typeof raw === "object" ? raw : {};
  const keyOk = (x) => typeof x === "string" && validKeys.includes(x);
  const avoid = Array.isArray(c.avoid) ? [...new Set(c.avoid.filter(keyOk))] : [];
  const suspects = Array.isArray(c.suspects)
    ? c.suspects.filter((s) => s && keyOk(s.id)).slice(0, 10).map((s) => ({
      id: s.id,
      n: Math.max(0, Math.min(999, Number(s.n) || 0)),
      bad: Math.max(0, Math.min(999, Number(s.bad) || 0)),
      symptoms: Array.isArray(s.symptoms) ? s.symptoms.filter((x) => typeof x === "string").map((x) => clip(x, 24)).slice(0, 5) : [],
    }))
    : [];
  const recent = Array.isArray(c.recent)
    ? c.recent.slice(0, LIMITS.recent).map((m) => ({
      d: clip(m && m.d, 80),
      ings: Array.isArray(m && m.ings) ? m.ings.filter(keyOk).slice(0, 6) : [],
      comps: Array.isArray(m && m.comps) ? m.comps.filter((x) => typeof x === "string").map((x) => clip(x, 30)).slice(0, 6) : [],
      f: m && m.f != null && isFinite(Number(m.f)) ? Math.round(Number(m.f) * 10) / 10 : null,
      s: Array.isArray(m && m.s) ? m.s.filter((x) => typeof x === "string").map((x) => clip(x, 24)).slice(0, 5) : [],
    }))
    : [];
  const baseline = c.baseline != null && isFinite(Number(c.baseline)) ? Math.round(Number(c.baseline) * 10) / 10 : null;
  const bw = c.bowel && typeof c.bowel === "object" ? c.bowel : null;
  const bowel = bw && Array.isArray(bw.counts) && bw.counts.length === 7
    ? {
      days: Math.max(1, Math.min(90, Number(bw.days) || 14)),
      counts: bw.counts.map((n) => Math.max(0, Math.min(999, Math.round(Number(n) || 0)))),
      pain: Math.max(0, Math.min(999, Number(bw.pain) || 0)),
      urgency: Math.max(0, Math.min(999, Number(bw.urgency) || 0)),
      blood: Math.max(0, Math.min(999, Number(bw.blood) || 0)),
    }
    : null;
  return { avoid, suspects, recent, baseline, bowel, wellbeing: sanitizeWellbeing(c.wellbeing) };
}

function contextText(ctx) {
  const lines = [];
  if (ctx.suspects.length) {
    lines.push("Senales detectadas (componente: comidas con malestar/total, sintomas): " +
      ctx.suspects.map((s) => `${s.id} ${s.bad}/${s.n}${s.symptoms.length ? " (" + s.symptoms.join(", ") + ")" : ""}`).join("; ") + ".");
  } else {
    lines.push("Sin senales claras de ningun componente.");
  }
  if (ctx.baseline != null) lines.push(`Nivel medio de bienestar en check-ins: ${ctx.baseline}/5.`);
  if (ctx.bowel && ctx.bowel.counts.some((n) => n > 0)) {
    const b = ctx.bowel;
    lines.push(`Senal digestiva, deposiciones de los ultimos ${b.days} dias por tipo de Bristol (tipo 1-2 estrenimiento, 3-4 normal, 5 blanda, 6-7 diarrea): ` +
      b.counts.map((n, i) => `tipo ${i + 1}: ${n}`).join(", ") +
      `. Con dolor: ${b.pain}, con urgencia: ${b.urgency}, con sangre: ${b.blood}. ` +
      "Si predominan los tipos 6-7 prioriza comidas astringentes y de digestion suave; si predominan 1-2, mas fibra e hidratacion; sin diagnosticar.");
  }
  if (ctx.wellbeing) {
    const w = ctx.wellbeing;
    const bits = [`${w.days} dia(s) registrados de los ultimos 7`];
    if (w.avgSleepH != null) bits.push(`sueno medio ${w.avgSleepH} h`);
    if (w.avgSleepQ != null) bits.push(`calidad media del sueno ${w.avgSleepQ}/5`);
    if (w.avgMood != null) bits.push(`animo medio ${w.avgMood}/5`);
    if (w.lowSleepDays) bits.push(`${w.lowSleepDays} dia(s) con poco sueno`);
    if (w.stressDays) bits.push(`${w.stressDays} dia(s) con estres o ansiedad`);
    if (w.lowMoodDays) bits.push(`${w.lowMoodDays} dia(s) con animo bajo`);
    if (w.tags.length) bits.push(`etiquetas frecuentes: ${w.tags.map((t) => WELLBEING_TAGS[t]).join(", ")}`);
    lines.push("Contexto de animo y sueno (ultima semana): " + bits.join("; ") + ".");
    if (w.factors.length) {
      lines.push("Coincidencias con malestar: " + w.factors.map((f) => `${WELLBEING_FACTORS[f.id]} (${f.badWith}/${f.withN} dias con malestar)`).join("; ") +
        ". Tenlo en cuenta en el plan (p. ej. cena ligera y temprana si duerme poco, comidas sencillas si hay estres), sin culpar a la comida de lo que puede venir del sueno o del estres.");
    }
  }
  if (ctx.recent.length) {
    lines.push("Comidas recientes (descripcion | componentes | nivel 1-5 | sintomas):");
    for (const m of ctx.recent) {
      lines.push(`- ${m.d || "(sin texto)"} | ${[...m.ings, ...m.comps].join(", ") || "-"} | ${m.f == null ? "-" : m.f} | ${m.s.join(", ") || "-"}`);
    }
  }
  return lines.join("\n");
}

function dietPrompt(scope, slot, ctx) {
  const slots = scope === "day" ? SLOTS : [slot];
  const avoidTxt = ctx.avoid.length
    ? "EXCLUYE por completo estos componentes y cualquier alimento que los contenga: " + ctx.avoid.join(", ") + ". " +
      "Prioriza comidas que den energia y poca pesadez (digestion ligera). "
    : "No hay senales claras: propone una dieta equilibrada y ligera, de digestion facil. ";
  return (
    "Eres un asistente de diario alimentario personal. " +
    "Propon una dieta de prueba para observar como responde la digestion del usuario. " +
    avoidTxt +
    "Usa alimentos comunes en Espana, raciones normales, preparaciones sencillas (plancha, horno, vapor). " +
    "Explica bien el plan para que el usuario pueda seguirlo sin dudas: cantidades aproximadas, " +
    "pasos de preparacion sencillos, por que ayuda, una alternativa equivalente y que observar despues. " +
    "Responde UNICAMENTE con un objeto JSON, sin texto antes o despues y sin bloques markdown. " +
    'Forma exacta: {"mode": "' + (ctx.avoid.length ? "exclusion" : "equilibrada") + '", ' +
    '"avoid": [<claves excluidas de: ' + FALLBACK_INGREDIENTS.join(", ") + ">], " +
    '"rationale": "<2-3 frases: por que este plan segun sus registros>", ' +
    '"meals": [' + slots.map((s) => '{"slot": "' + s + '", "time": "<hora aproximada HH:MM>", ' +
      '"name": "<nombre del plato>", "items": ["<ingrediente con cantidad, ej. 150 g de merluza>"], ' +
      '"steps": ["<paso de preparacion>"], "why": "<por que ayuda a la digestion y da energia>", ' +
      '"swap": "<alternativa equivalente que respete las exclusiones>", ' +
      '"watch": "<que observar y cuando, ej. hinchazon 1-2 h despues>"}').join(", ") + "], " +
    '"tips": ["<consejos para seguir el plan y observar la digestion>"]}. ' +
    "Exactamente " + slots.length + " elemento(s) en meals, en ese orden. " +
    "Usa comillas dobles y sin comas finales, para que sea JSON.parse valido.\n" +
    "Datos registrados por el usuario:\n" + contextText(ctx)
  );
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

function normalizeSlot(s, fallback) {
  const t = String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (SLOTS.includes(t)) return t;
  if (/almuerzo|lunch/.test(t)) return "comida";
  if (/breakfast/.test(t)) return "desayuno";
  if (/dinner|cenar/.test(t)) return "cena";
  if (/snack|tentempie/.test(t)) return "merienda";
  return fallback;
}

function normalizePlan(obj, scope, slot, avoidIn, validKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const valid = validKeys && validKeys.length ? validKeys : FALLBACK_INGREDIENTS;
  const wanted = scope === "day" ? SLOTS : [slot];
  const rawMeals = Array.isArray(obj.meals) ? obj.meals : [];
  const meals = [];
  rawMeals.forEach((m, i) => {
    if (!m || typeof m !== "object") return;
    const name = clip(m.name || m.plato, LIMITS.name);
    if (!name) return;
    const s = normalizeSlot(m.slot, wanted[i] || wanted[wanted.length - 1]);
    if (!wanted.includes(s) || meals.some((x) => x.slot === s)) return;
    const list = (v, n, max) => (Array.isArray(v) ? v : [])
      .filter((x) => typeof x === "string").map((x) => clip(x, n)).filter(Boolean).slice(0, max);
    const time = /^([01]?\d|2[0-3])[:.h]([0-5]\d)$/.exec(String(m.time || "").trim());
    meals.push({
      slot: s,
      ...(time ? { time: time[1].padStart(2, "0") + ":" + time[2] } : {}),
      name,
      items: list(m.items, LIMITS.item, LIMITS.items),
      steps: list(m.steps, LIMITS.step, LIMITS.steps),
      why: clip(m.why, LIMITS.why),
      swap: clip(m.swap, LIMITS.swap),
      watch: clip(m.watch, LIMITS.watch),
    });
  });
  if (!meals.length) return null;
  meals.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  // Las exclusiones del cliente mandan: la IA puede añadir, nunca quitar.
  const avoid = [...new Set([...(avoidIn || []), ...(Array.isArray(obj.avoid) ? obj.avoid : [])]
    .filter((x) => typeof x === "string" && valid.includes(x)))];
  const tips = (Array.isArray(obj.tips) ? obj.tips : [])
    .filter((x) => typeof x === "string").map((x) => clip(x, LIMITS.tip)).filter(Boolean).slice(0, LIMITS.tips);
  return {
    mode: avoid.length ? "exclusion" : "equilibrada",
    avoid,
    rationale: clip(obj.rationale || obj.resumen, LIMITS.rationale) ||
      (avoid.length ? "Plan sin los componentes que coinciden con tus molestias." : "Plan equilibrado y ligero."),
    meals,
    tips,
    complete: meals.length === wanted.length,
  };
}

function parsePlanJson(text, providerLabel, scope, slot, avoid, validKeys, diag) {
  const raw = String(text || "");
  const extra = diag ? ` (${diag})` : "";
  const cut = /max_tokens|length/i.test(diag || "") ? " Se cortó por límite de longitud: pulsa de nuevo." : "";
  if (!raw.trim()) {
    return { error: `${providerLabel} devolvió una respuesta vacía${extra}.${cut}` };
  }
  const defenced = stripFences(raw);
  let obj = tryParseOne(defenced.trim());
  if (!obj) {
    for (const cand of balancedCandidates(defenced)) {
      obj = tryParseOne(cand.trim());
      if (obj) break;
    }
  }
  const plan = obj && normalizePlan(obj, scope, slot, avoid, validKeys);
  if (!plan) return { error: `${providerLabel} respondió pero no en el formato esperado${extra}.${cut}` };
  return { result: plan };
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
// Y si rechaza max_tokens por encima de su máximo, se reintenta con el que
// indique el propio error (o un valor seguro).
// El límite de tokens de salida por minuto se estima con max_tokens al empezar,
// así que en cuentas de tier bajo un 429 por ese límite se reintenta una vez con menos.
const CLAUDE_RATELIMIT_MAX_TOKENS = 16000;
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

const RETRY = " Pulsa de nuevo «Pedir dieta».";

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
async function claudeCall({ key, model, scope, slot, ctx, validKeys }) {
  const m = model || DEFAULT_CLAUDE_MODEL;
  let res;
  try {
    ({ res } = await claudeFetch(key, {
      model: m,
      max_tokens: claudeMaxOutput(m),
      ...claudeThinking(m),
      messages: [{ role: "user", content: dietPrompt(scope, slot, ctx) }],
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
  const text = claudeText(read.data);
  const parsed = parsePlanJson(text, "Claude", scope, slot, ctx.avoid, validKeys, diagClaude(read.data));
  if (parsed.error) return fail("badjson", parsed.error + RETRY, 502);
  return json({ ok: true, provider: "claude", action: "plan", result: parsed.result });
}

async function groqCall({ key, groqModel, scope, slot, ctx, validKeys }) {
  const body = {
    model: groqModel || DEFAULT_GROQ_MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Respondes SOLO con JSON válido, sin texto adicional." },
      { role: "user", content: dietPrompt(scope, slot, ctx) },
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
  const text = (c && c.message && c.message.content) || "";
  const parsed = parsePlanJson(text, "Groq", scope, slot, ctx.avoid, validKeys, diagGroq(read.data));
  if (parsed.error) return fail("badjson", parsed.error + RETRY, 502);
  return json({ ok: true, provider: "groq", action: "plan", result: parsed.result });
}

// ---- Entrada Pages Functions ----
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  if (request.method === "GET") {
    return json({ ok: true, service: "diet-proxy", providers: ["claude", "groq"], scopes: ["day", "meal"] });
  }
  if (request.method !== "POST") {
    return fail("badrequest", "Usa POST con { provider, key, scope, … }.", 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("badrequest", "El cuerpo debe ser JSON con { provider, key, scope, … }.", 400);
  }

  const provider = String((body && body.provider) || "").toLowerCase();
  const key = String((body && body.key) || "").trim();
  const scope = String((body && body.scope) || "day").toLowerCase();
  const slot = normalizeSlot(body && body.slot, "");

  if (!["claude", "groq", "hermes", "cursor"].includes(provider)) {
    return fail("badrequest", "Proveedor desconocido: usa claude, groq, hermes o cursor.", 400);
  }
  if (!["day", "meal"].includes(scope)) {
    return fail("badrequest", "Alcance desconocido: usa day o meal.", 400);
  }
  if (scope === "meal" && !slot) {
    return fail("badrequest", "Para una sola comida indica slot: desayuno, comida, merienda o cena.", 400);
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
    key,
    model: String(body.model || "").trim(),
    groqModel: String(body.groqModel || "").trim(),
    scope,
    slot: scope === "meal" ? slot : "",
    ctx: sanitizeContext(body.context, validKeys),
    validKeys,
  };

  // Sin console.log del body ni de la key.
  try {
    if (provider === "claude") return await claudeCall(args);
    return await groqCall(args);
  } catch {
    return fail("unknown", "El proxy falló de forma inesperada. Reintenta; el plan local sigue disponible.", 500);
  }
}
