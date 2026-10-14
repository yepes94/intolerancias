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
 *     planDiet(input, apiKey, model, settings) -> /api/diet
 *     analyzeDiary({ entry, meals, suspects, bowel, wellbeing }, apiKey, model, settings) -> /api/diary
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
        "Si subiste foto, el análisis con IA (Claude con visión) puede ver más.";
    }
    const bits = ingredients.map((id) => {
      const w = D().ONSET_WINDOWS[id];
      return w ? `${w.label} (suele notarse entre ${fmtH(w.startH)} y ${fmtH(w.endH)} tras comer)` : id;
    });
    return "Posibles ingredientes a vigilar: " + bits.join(" · ") + ".";
  }

  function fmtH(h) {
    if (h < 1) return Math.round(h * 60) + " min";
    if (h === 1) return "1 h";
    return h + " h";
  }

  const PROXY_URL = "/api/analyze";
  const DIET_URL = "/api/diet";
  const DIARY_URL = "/api/diary";

  // Todo el tráfico IA sale por el proxy same-origin de Pages Functions:
  // el navegador nunca toca api.anthropic.com/api.groq.com (adiós CORS) y
  // la clave BYOK viaja solo en el cuerpo de la petición (nunca se guarda
  // en servidor ni en logs; ver functions/api/analyze.js).

  function foodPrompt(description, hasImage) {
    const keys = Object.keys(D().ONSET_WINDOWS).join(", ");
    return "Eres un asistente de diario alimentario personal. " +
      "Analiza esta comida y responde UNICAMENTE con un objeto JSON, sin nada mas: " +
      "ni saludos, ni explicaciones antes o despues, ni bloques markdown (nada de ```), solo el objeto. " +
      "Se conciso y directo: la respuesta completa debe ser corta (menos de ~250 palabras en total). " +
      'Forma exacta: {"food": "<alimento detectado en 2-5 palabras>", ' +
      '"components": ["<solo los componentes relevantes de intolerancia/alergia, máx. 6>"], ' +
      '"ingredients": [<solo las claves relevantes de: ' + keys + "> que correspondan a esos componentes], " +
      '"summary": "<1 frase corta, máx. 280 caracteres, tono cercano, que vigilar y por que>", ' +
      '"checkinQuestion": "<pregunta corta tipo como te sientes>"}. ' +
      "Usa comillas dobles y sin comas finales, para que sea JSON.parse valido. " +
      "Comida: " + (description || "(solo foto)") + (hasImage ? " [incluye foto]" : "");
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

  // ---- Proxy /api/analyze (Pages Functions) ----
  // Unifica ping + analyze de todos los proveedores: el frontend manda
  // { provider, action, key, … } y el proxy reenvía al proveedor con la
  // clave BYOK. La respuesta ya trae la taxonomía (kind) del servidor.
  async function proxyCall(providerId, providerLabel, action, payload, url) {
    const validIngredients = Object.keys(D().ONSET_WINDOWS);
    const target = url || PROXY_URL;
    const reqBody = url === DIARY_URL
      ? {
        provider: providerId,
        key: payload.apiKey,
        model: payload.model || D().DEFAULT_MODEL,
        groqModel: payload.groqModel || D().GROQ_MODEL,
        entry: payload.entry || {},
        meals: payload.meals || [],
        suspects: payload.suspects || [],
        ...(Array.isArray(payload.bowel) && payload.bowel.length ? { bowel: payload.bowel } : {}),
        ...(payload.wellbeing ? { wellbeing: payload.wellbeing } : {}),
        validIngredients
      }
      : url === DIET_URL
      ? {
        provider: providerId,
        key: payload.apiKey,
        model: payload.model || D().DEFAULT_MODEL,
        groqModel: payload.groqModel || D().GROQ_MODEL,
        scope: payload.scope,
        slot: payload.slot || "",
        context: payload.context || {},
        validIngredients
      }
      : {
        provider: providerId,
        action,
        key: payload.apiKey,
        model: payload.model || D().DEFAULT_MODEL,
        groqModel: payload.groqModel || D().GROQ_MODEL,
        description: payload.description || "",
        imageDataUrl: payload.imageDataUrl || null,
        validIngredients
      };
    let res;
    try {
      res = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody)
      });
    } catch (err) {
      throw codedError("network",
        "No se pudo contactar con el proxy " + target + " (red o la app no está " +
        "servida desde Pages/wrangler: en file:// o python -m http.server el proxy " +
        "no existe). El modo local sigue funcionando.");
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok || !body || body.ok !== true) {
      const kind = (body && body.kind) || "unknown";
      const message = (body && body.message) || `${providerLabel} ${res.status}: ${res.statusText}`;
      throw codedError(kind, message);
    }
    return body.result;
  }

  // Compat: los errores del proxy ya vienen con kind; httpError se conserva
  // para los tests y como respaldo si el proxy devolviera un HTTP sin JSON.

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
        title: `${label} no responde: sin red o sin proxy /api/analyze.`,
        hint: "Acción: comprueba tu conexión. El proxy solo existe servido desde " +
          "Cloudflare Pages o `wrangler pages dev` (en file:// o `python -m http.server` " +
          "no hay proxy y no hay CORS que temer). El análisis local sigue funcionando sin conexión."
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

  function checkPlan(result, label) {
    if (!result || !Array.isArray(result.meals) || !result.meals.length) {
      throw codedError("badjson",
        label + " respondió pero sin un plan reconocible. Pulsa de nuevo «Pedir dieta»; " +
        "el plan local sigue disponible.");
    }
    return result;
  }

  function checkDiary(result, label) {
    if (!result || typeof result.summary !== "string" || !Array.isArray(result.causes)) {
      throw codedError("badjson",
        label + " respondió pero sin un análisis reconocible. Pulsa «Reanalizar»; " +
        "el análisis local sigue disponible.");
    }
    return result;
  }

  const Providers = {
    order: ["claude", "hermes", "groq", "cursor"],

    registry: {
      claude: {
        id: "claude",
        label: "Claude (Anthropic)",
        implemented: true,
        needsVision: true,

        async ping(apiKey, model, settings) {
          return proxyCall("claude", "Claude", "ping", {
            apiKey, model, groqModel: settings && settings.groqModel
          });
        },

        async analyzeFood({ description, imageDataUrl }, apiKey, model, settings) {
          const result = await proxyCall("claude", "Claude", "analyze", {
            apiKey, model,
            groqModel: settings && settings.groqModel,
            description, imageDataUrl
          });
          // El proxy ya devuelve { ingredients, summary, checkinQuestion } limpio.
          if (!result || typeof result.summary !== "string") {
            throw codedError("badjson",
              "Claude respondió pero no en el formato esperado. Pulsa de nuevo " +
              "«Analizar con IA»; el análisis local sigue funcionando.");
          }
          return result;
        },

        async planDiet({ scope, slot, context }, apiKey, model, settings) {
          return checkPlan(await proxyCall("claude", "Claude", "plan", {
            apiKey, model, groqModel: settings && settings.groqModel, scope, slot, context
          }, DIET_URL), "Claude");
        },

        async analyzeDiary({ entry, meals, suspects, bowel, wellbeing }, apiKey, model, settings) {
          return checkDiary(await proxyCall("claude", "Claude", "diary", {
            apiKey, model, groqModel: settings && settings.groqModel, entry, meals, suspects, bowel, wellbeing
          }, DIARY_URL), "Claude");
        }
      },

      // ---- Stubs: misma firma, sin refactorizar al implementarlos ----
      hermes: {
        id: "hermes", label: "Hermes", implemented: false, needsVision: true,
        async ping() { throw codedError("notimpl", "Proveedor Hermes aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw codedError("notimpl", "Proveedor Hermes aún no implementado."); },
        async planDiet() { throw codedError("notimpl", "Proveedor Hermes aún no implementado."); },
        async analyzeDiary() { throw codedError("notimpl", "Proveedor Hermes aún no implementado."); }
      },
      groq: {
        id: "groq",
        label: "Groq",
        implemented: true,
        needsVision: true,

        async ping(apiKey, _model, settings) {
          const key = (apiKey || "").trim();
          if (!/^gsk_/.test(key)) {
            throw codedError("auth", "Esa clave no parece de Groq (suelen empezar por “gsk_”). Consigue una gratis en console.groq.com/keys.");
          }
          return proxyCall("groq", "Groq", "ping", {
            apiKey, groqModel: settings && settings.groqModel
          });
        },

        async analyzeFood({ description, imageDataUrl }, apiKey, _model, settings) {
          const result = await proxyCall("groq", "Groq", "analyze", {
            apiKey, groqModel: settings && settings.groqModel,
            description, imageDataUrl
          });
          if (!result || typeof result.summary !== "string") {
            throw codedError("badjson",
              "Groq respondió pero no en el formato esperado. Pulsa de nuevo " +
              "«Analizar con IA»; el análisis local sigue funcionando.");
          }
          return result;
        },

        async planDiet({ scope, slot, context }, apiKey, _model, settings) {
          return checkPlan(await proxyCall("groq", "Groq", "plan", {
            apiKey, groqModel: settings && settings.groqModel, scope, slot, context
          }, DIET_URL), "Groq");
        },

        async analyzeDiary({ entry, meals, suspects, bowel, wellbeing }, apiKey, _model, settings) {
          return checkDiary(await proxyCall("groq", "Groq", "diary", {
            apiKey, groqModel: settings && settings.groqModel, entry, meals, suspects, bowel, wellbeing
          }, DIARY_URL), "Groq");
        }
      },
      cursor: {
        id: "cursor", label: "Cursor", implemented: false, needsVision: false,
        async ping() { throw codedError("notimpl", "Proveedor Cursor aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw codedError("notimpl", "Proveedor Cursor aún no implementado."); },
        async planDiet() { throw codedError("notimpl", "Proveedor Cursor aún no implementado."); },
        async analyzeDiary() { throw codedError("notimpl", "Proveedor Cursor aún no implementado."); }
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
