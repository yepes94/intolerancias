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
      "Analiza esta comida y responde SOLO con JSON valido con esta forma: " +
      '{"ingredients": [<claves de: ' + keys + ">], " +
      '"summary": "<1-2 frases, tono cercano, que vigilar y por que>", ' +
      '"checkinQuestion": "<pregunta corta tipo como te sientes>"}.\n' +
      "Comida: " + (description || "(solo foto)") + (hasImage ? " [incluye foto]" : "") +
      "\nRecuerda: anade que es orientativo y no sustituye una prueba medica real.";
  }

  function parseJsonLoose(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("La IA no devolvió un JSON reconocible.");
    const obj = JSON.parse(m[0]);
    const valid = Object.keys(D().ONSET_WINDOWS);
    obj.ingredients = (obj.ingredients || []).filter((i) => valid.includes(i));
    return obj;
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
          const res = await fetch(CLAUDE_URL, {
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
            throw new Error(`Claude ${res.status}: ${t.slice(0, 160) || res.statusText}`);
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
          const res = await fetch(CLAUDE_URL, {
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
            throw new Error(`Claude ${res.status}: ${t.slice(0, 200) || res.statusText}`);
          }
          const data = await res.json();
          const text = (data.content || []).map((b) => b.text || "").join("");
          const parsed = parseJsonLoose(text);
          parsed.summary = (parsed.summary || "") + " " + D().DISCLAIMER;
          return parsed;
        }
      },

      // ---- Stubs: misma firma, sin refactorizar al implementarlos ----
      hermes: {
        id: "hermes", label: "Hermes", implemented: false, needsVision: true,
        async ping() { throw new Error("Proveedor Hermes aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw new Error("Proveedor Hermes aún no implementado."); }
      },
      groq: {
        id: "groq",
        label: "Groq",
        implemented: true,
        needsVision: true,

        async ping(apiKey) {
          const key = (apiKey || "").trim();
          if (!/^gsk_/.test(key)) {
            throw new Error("Esa clave no parece de Groq (suelen empezar por “gsk_”). Consigue una gratis en console.groq.com/keys.");
          }
          const res = await fetch(GROQ_MODELS_URL, {
            headers: { authorization: "Bearer " + key }
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`Groq ${res.status}: ${t.slice(0, 160) || res.statusText}`);
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
          const res = await fetch(GROQ_CHAT_URL, {
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
            throw new Error(`Groq ${res.status}: ${t.slice(0, 200) || res.statusText}`);
          }
          const data = await res.json();
          const text = (data.choices && data.choices[0] && data.choices[0].message &&
            data.choices[0].message.content) || "";
          const parsed = parseJsonLoose(text);
          parsed.summary = (parsed.summary || "") + " " + D().DISCLAIMER;
          return parsed;
        }
      },
      cursor: {
        id: "cursor", label: "Cursor", implemented: false, needsVision: false,
        async ping() { throw new Error("Proveedor Cursor aún no implementado (pendiente, sin refactorizar: implementar ping + analyzeFood aquí)."); },
        async analyzeFood() { throw new Error("Proveedor Cursor aún no implementado."); }
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
    }
  };

  window.IntolProviders = Providers;
})();
