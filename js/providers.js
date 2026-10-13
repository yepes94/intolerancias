/* Intolerancias · js/providers.js
 *
 * Abstracción de proveedores de IA (BYOK, solo localStorage).
 *
 *   AIProvider = {
 *     id: "claude" | "hermes" | "groq" | "cursor",
 *     label: string,
 *     implemented: boolean,          // false = stub, pendiente sin refactorizar
 *     needsVision: boolean,
 *     analyzeFood(input, apiKey, model) -> Promise<{ ingredients: string[], summary: string, checkinQuestion: string }>
 *     ping(apiKey, model) -> Promise<string>   // "ok" o lanza Error explicativo
 *   }
 *
 * Para añadir Hermes/Cursor: implementar analyzeFood + ping en su
 * entrada del registro con la misma firma. Nada más cambia (prioridad,
 * selección, UI y llamadas ya son genéricas). Orden: Claude > Hermes > Groq > Cursor.
 */
(function () {
  "use strict";

  const D = () => window.IntolData;

  function heuristicIngredients(text) {
    const norm = (text || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const found = [];
    for (const [re, ing] of D().KEYWORDS) {
      if (re.test(norm) && !found.includes(ing)) found.push(ing);
    }
    return found;
  }

  function heuristicSummary(ingredients) {
    if (!ingredients.length) {
      return "No detecto ingredientes típicos a vigilar en tu descripción. " +
        "Si subiste foto, el análisis con IA (Claude con visión) puede ver más. " + D().DISCLAIMER;
    }
    const bits = ingredients.map((id) => {
      const w = D().ONSET_WINDOWS[id];
      return w ? `${w.label} (suele notarse entre ${fmtH(w.startH)} y ${fmtH(w.endH)} tras comer)` : id;
    });
    return "Posibles ingredientes a vigilar: " + bits.join(" · ") + ". " + D().DISCLAIMER;
  }

  function fmtH(h) {
    if (h < 1) return Math.round(h * 60) + " min";
    if (h === 1) return "1 h";
    return h + " h";
  }

  const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

  // Groq expone una API compatible con OpenAI (permite llamadas directas desde el navegador).
  const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
  const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

  function claudeHeaders(apiKey) {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Requerido para llamadas directas desde el navegador (CORS).
      "anthropic-dangerous-direct-browser-access": "true"
    };
  }

  function foodPrompt(description, hasImage) {
    const keys = Object.keys(D().ONSET_WINDOWS).join(", ");
    return "Eres un asistente de diario alimentario personal. NO eres medico y NO diagnosticas. " +
      "Analiza esta comida y responde UNICAMENTE con un objeto JSON, sin nada mas: " +
      "ni saludos, ni explicaciones antes o despues, ni bloques markdown (nada de ```), solo el objeto. " +
      'Forma exacta: {"ingredients": [<claves de: ' + keys + ">], " +
      '"summary": "<1-2 frases, tono cercano, que vigilar y por que>", ' +
      '"checkinQuestion": "<pregunta corta tipo como te sientes>"}. ' +
      "Usa comillas dobles y sin comas finales, para que sea JSON.parse valido. " +
      "Comida: " + (description || "(solo foto)") + (hasImage ? " [incluye foto]" : "") +
      "\nRecuerda: anade que es orientativo y no sustituye una prueba medica real.";
  }

  // ---- Errores con causa distinguible (clave vs red/CORS vs JSON) ----
  // Toda Error lanzada por los proveedores lleva `.kind`:
  //   "auth" (401/403 o clave con formato raro), "network" (TypeError de
  //   fetch: sin red, DNS, CORS bloqueado), "badjson" (el proveedor
  //   respondió pero sin JSON aprovechable), "ratelimit" (429),
  //   "badrequest" (400: modelo/parámetros), "server" (5xx),
  //   "notimpl" (stub), "unknown" (resto).
  function codedError(kind, message) {
    const e = new Error(message);
    e.kind = kind;
    return e;
  }

  function isNetworkFailure(err) {
    return err instanceof TypeError ||
      /failed to fetch|networkerror|load failed|cors|network request failed/i.test(err && err.message || "");
  }

  async function safeFetch(url, opts) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw codedError("network",
        "No se pudo contactar con el proveedor (red o CORS). " +
        "Comprueba tu conexión; si usas file:// o una extensión que bloquee, " +
        "prueba por http://localhost. El análisis local sigue funcionando.");
    }
    return res;
  }

  function httpError(providerLabel, status, bodyText, statusText) {
    const head = (bodyText || "").slice(0, 200) || statusText || ("HTTP " + status);
    if (status === 401 || status === 403) {
      return codedError("auth",
        `${providerLabel} rechazó la clave (HTTP ${status}). Revisa que la pegaste ` +
        `completa en Ajustes y que no caducó. Detalle: ${head}`);
    }
    if (status === 429) {
      return codedError("ratelimit",
        `${providerLabel} dice que hay demasiadas peticiones o sin cuota (HTTP 429). ` +
        `Espera unos minutos o revisa tu plan/límites. Detalle: ${head}`);
    }
    if (status === 400) {
      return codedError("badrequest",
        `${providerLabel} rechazó la petición (HTTP 400): revisa el modelo en Ajustes ` +
        `o quita la foto si el modelo no tiene visión. Detalle: ${head}`);
    }
    if (status >= 500) {
      return codedError("server",
        `${providerLabel} falla en su lado (HTTP ${status}). Reintenta en unos minutos; ` +
        `el análisis local sigue funcionando. Detalle: ${head}`);
    }
    return codedError("unknown", `${providerLabel} ${status}: ${head}`);
  }

  // ---- Parsing robusto de la respuesta del modelo ----
  // Los modelos a veces envuelven el JSON en ```json, añaden prosa antes/
  // después, usan comillas simples o dejan comas finales. Se intenta
  // recuperar todo lo recuperable antes de rendirse con un error "badjson"
  // accionable (reintentar), en vez del genérico "revisa tu clave".
  function stripFences(text) {
    // Si hay bloques ```...```, el JSON suele estar dentro: quédate con su contenido.
    // Si no hay fences, devuelve el texto tal cual (sin marcas sueltas).
    const s = String(text || "");
    const inner = [];
    const re = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(s))) inner.push(m[1]);
    if (inner.length) return inner.join("\n");
    return s.replace(/```/g, " ");
  }

  // Extrae el primer substring {...} balanceado (ignora llaves dentro de strings).
  function balancedCandidates(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf("{", i);
      if (start < 0) break;
      let depth = 0, inStr = false, esc = false;
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
          if (depth === 0) { out.push(text.slice(start, j + 1)); i = j + 1; break; }
        }
      }
      if (depth !== 0) break; // sin cierre: no hay más candidatos
    }
    return out;
  }

  function repairJson(text) {
    // Reparaciones mínimas y seguras: comas finales y punto y coma final.
    return String(text)
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/;\s*$/, "");
  }

  function tryParseOne(candidate) {
    try { return JSON.parse(candidate); } catch { /* sigue */ }
    try { return JSON.parse(repairJson(candidate)); } catch { /* sigue */ }
    // Comillas simples -> dobles solo si no hay dobles (evita romper texto con ambas).
    if (!candidate.includes('"') && candidate.includes("'")) {
      const swapped = candidate.replace(/'/g, '"');
      try { return JSON.parse(swapped); } catch { /* sigue */ }
      try { return JSON.parse(repairJson(swapped)); } catch { /* sigue */ }
    }
    return null;
  }

  function normalizeAnalysis(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const valid = Object.keys(D().ONSET_WINDOWS);
    const ingredients = Array.isArray(obj.ingredients)
      ? obj.ingredients.filter((x) => typeof x === "string" && valid.includes(x.trim())).map((x) => x.trim())
      : (typeof obj.ingredients === "string"
        ? obj.ingredients.split(/[,;|\n]/).map((x) => x.trim()).filter((x) => valid.includes(x))
        : []);
    // Deduplica preservando orden.
    const seen = new Set();
    const dedup = ingredients.filter((x) => !seen.has(x) && (seen.add(x), true));
    const summary = typeof obj.summary === "string" ? obj.summary.trim()
      : (typeof obj.resumen === "string" ? obj.resumen.trim() : "");
    const checkinQuestion = typeof obj.checkinQuestion === "string" ? obj.checkinQuestion.trim()
      : (typeof obj.pregunta === "string" ? obj.pregunta.trim() : "");
    if (!summary && !dedup.length && !checkinQuestion) return null;
    return {
      ingredients: dedup,
      summary: summary || "La IA no dio detalles; vigila cómo te sientes en las próximas horas.",
      checkinQuestion: checkinQuestion || "¿Cómo te sientes?"
    };
  }

  function parseAnalysisJson(text, providerLabel) {
    const raw = String(text || "");
    if (!raw.trim()) {
      throw codedError("badjson",
        `${providerLabel} devolvió una respuesta vacía. Pulsa de nuevo «Analizar con IA»; ` +
        `si se repite, prueba sin foto o con otro modelo. El análisis local sigue funcionando.`);
    }
    const defenced = stripFences(raw);
    // 1) Todo el texto (limpio de fences) tal cual.
    let obj = tryParseOne(defenced.trim());
    // 2) Primeros objetos {...} balanceados, en orden.
    if (!obj) {
      for (const cand of balancedCandidates(defenced)) {
        obj = tryParseOne(cand.trim());
        if (obj) break;
      }
    }
    const norm = obj && normalizeAnalysis(obj);
    if (!norm) {
      throw codedError("badjson",
        `${providerLabel} respondió pero no en el formato esperado. Pulsa de nuevo ` +
        `«Analizar con IA» (a veces basta reintentar); si persiste, usa el análisis local, ` +
        `que sigue funcionando.`);
    }
    return norm;
  }

  // Compat: antes era un regex voraz + JSON.parse directo (SyntaxError crudos a la UI).
  function parseJsonLoose(text) {
    return parseAnalysisJson(text, "La IA");
  }

  // Mensaje accionable para la UI a partir de cualquier error de proveedor.
  // Devuelve { title, hint } ya redactados en español.
  function describeError(err, providerLabel) {
    const label = providerLabel || "La IA";
    if (err && err.kind === "auth") {
      return {
        title: err.message,
        hint: "Acción: abre Ajustes, borra la clave y pégala de nuevo completa (sin espacios). " +
          "El análisis local por palabras clave sigue funcionando sin clave."
      };
    }
    if (err && (err.kind === "network" || isNetworkFailure(err))) {
      return {
        title: `${label} no responde por red o el navegador bloqueó la llamada (CORS).`,
        hint: "Acción: comprueba tu conexión, desactiva bloqueadores/VPN para probar, " +
          "y sirve la app por http://localhost en vez de file://. " +
          "El análisis local sigue funcionando sin conexión."
      };
    }
    if (err && err.kind === "badjson") {
      return {
        title: err.message,
        hint: "Acción: pulsa de nuevo «Analizar con IA»; si se repite, prueba con solo texto " +
          "(sin foto) o con otro proveedor. El análisis local sigue funcionando."
      };
    }
    if (err && err.kind === "ratelimit") {
      return {
        title: err.message,
        hint: "Acción: espera unos minutos y reintenta. Mientras tanto, el análisis local sigue funcionando."
      };
    }
    if (err && (err.kind === "badrequest" || err.kind === "server")) {
      return { title: err.message, hint: "El análisis local sigue funcionando mientras tanto." };
    }
    if (err && err.kind === "notimpl") {
      return {
        title: err.message,
        hint: "El análisis local por palabras clave sigue funcionando; no sale nada de tu navegador."
      };
    }
    return {
      title: (err && err.message) ? String(err.message) : `${label} falló de forma inesperada.`,
      hint: "Acción: reintenta; si persiste, usa el análisis local o prueba con otro proveedor en Ajustes."
    };
  }

  const Providers = {
    order: ["claude", "hermes", "groq", "cursor"],

    registry: {
      claude: {
        id: "claude",
        label: "Claude (Anthropic)",
        implemented: true,
        needsVision: true,

        async ping(apiKey, model) {
          const res = await safeFetch(CLAUDE_URL, {
            method: "POST",
            headers: claudeHeaders(apiKey),
            body: JSON.stringify({
              model: model || D().DEFAULT_MODEL,
              max_tokens: 20,
              messages: [{ role: "user", content: "Responde solo: ok" }]
            })
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw httpError("Claude", res.status, t, res.statusText);
          }
          return "ok";
        },

        async analyzeFood({ description, imageDataUrl }, apiKey, model) {
          const content = [];
          if (imageDataUrl) {
            const m = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (m) {
              content.push({
                type: "image",
                source: { type: "base64", media_type: m[1], data: m[2] }
              });
            }
          }
          content.push({ type: "text", text: foodPrompt(description, !!imageDataUrl) });
          const res = await safeFetch(CLAUDE_URL, {
            method: "POST",
            headers: claudeHeaders(apiKey),
            body: JSON.stringify({
              model: model || D().DEFAULT_MODEL,
              max_tokens: 500,
              messages: [{ role: "user", content }]
            })
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw httpError("Claude", res.status, t, res.statusText);
          }
          const data = await res.json();
          const text = (data.content || []).map((b) => b.text || "").join("");
          const parsed = parseAnalysisJson(text, "Claude");
          parsed.summary = (parsed.summary || "") + " " + D().DISCLAIMER;
          return parsed;
        }
      },

      // ---- Stubs: misma firma, sin refactorizar al implementarlos ----
      hermes: {
        id: "hermes", label: "Hermes", implemented: false, needsVision: true,
        async ping() { throw codedError("notimpl", "Proveedor Hermes aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw codedError("notimpl", "Proveedor Hermes aún no implementado."); }
      },
      groq: {
        id: "groq",
        label: "Groq",
        implemented: true,
        needsVision: true,

        async ping(apiKey) {
          const key = (apiKey || "").trim();
          if (!/^gsk_/.test(key)) {
            throw codedError("auth", "Esa clave no parece de Groq (suelen empezar por “gsk_”). Consigue una gratis en console.groq.com/keys.");
          }
          const res = await safeFetch(GROQ_MODELS_URL, {
            headers: { authorization: "Bearer " + key }
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw httpError("Groq", res.status, t, res.statusText);
          }
          return "ok";
        },

        async analyzeFood({ description, imageDataUrl }, apiKey, _model, settings) {
          const hasImage = !!imageDataUrl;
          // Con foto se usa el modelo con visión; sin foto, el de texto (configurable en Ajustes).
          const model = hasImage
            ? D().GROQ_VISION_MODEL
            : ((settings && settings.groqModel) || D().GROQ_MODEL);
          const content = [];
          if (hasImage) {
            content.push({ type: "image_url", image_url: { url: imageDataUrl } });
          }
          content.push({ type: "text", text: foodPrompt(description, hasImage) });
          const res = await safeFetch(GROQ_CHAT_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + apiKey
            },
            body: JSON.stringify({
              model,
              max_tokens: 500,
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: "Respondes SOLO con JSON válido, sin texto adicional." },
                { role: "user", content }
              ]
            })
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw httpError("Groq", res.status, t, res.statusText);
          }
          const data = await res.json();
          const text = (data.choices && data.choices[0] && data.choices[0].message &&
            data.choices[0].message.content) || "";
          const parsed = parseAnalysisJson(text, "Groq");
          parsed.summary = (parsed.summary || "") + " " + D().DISCLAIMER;
          return parsed;
        }
      },
      cursor: {
        id: "cursor", label: "Cursor", implemented: false, needsVision: false,
        async ping() { throw codedError("notimpl", "Proveedor Cursor aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw codedError("notimpl", "Proveedor Cursor aún no implementado."); }
      }
    },

    /** Proveedores con clave configurada (respeta la prioridad). */
    available(settings) {
      return this.order
        .map((id) => this.registry[id])
        .filter((p) => p && settings.keys && settings.keys[p.id]);
    },

    /** Proveedor activo: preferido del usuario o primero disponible por prioridad. */
    active(settings) {
      const avail = this.available(settings);
      if (!avail.length) return null;
      if (settings.preferred && settings.preferred !== "auto") {
        const pick = avail.find((p) => p.id === settings.preferred);
        if (pick) return pick;
      }
      return avail[0]; // order[] ya es la prioridad Claude > Hermes > Groq > Cursor
    },

    /** Análisis local sin IA (siempre disponible, offline). */
    localAnalyze(description) {
      const ingredients = heuristicIngredients(description);
      return {
        ingredients,
        summary: heuristicSummary(ingredients),
        checkinQuestion: ingredients.length
          ? "¿Cómo te sientes? Presta atención a molestias digestivas en las próximas horas."
          : "¿Cómo te sientes?",
        source: "local"
      };
    },

    // Utilidades para la UI y pruebas: parseo + mensajes accionables.
    parseAnalysisJson,
    describeError
  };

  window.IntolProviders = Providers;
})();
