import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// Claves del servidor (.env) como respaldo si el cliente no envía la suya
const SERVER_KEYS = {
  groq: process.env.GROQ_API_KEY || "",
  openai: process.env.OPENAI_API_KEY || "",
  anthropic: process.env.ANTHROPIC_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
  mistral: process.env.MISTRAL_API_KEY || "",
  cohere: process.env.COHERE_API_KEY || "",
  together: process.env.TOGETHER_API_KEY || "",
  openrouter: process.env.OPENROUTER_API_KEY || "",
  deepseek: process.env.DEEPSEEK_API_KEY || "",
  xai: process.env.XAI_API_KEY || "",
  perplexity: process.env.PERPLEXITY_API_KEY || "",
};

const SYSTEM_PROMPT =
  "Eres un asistente experto en intolerancias alimentarias (gluten, lactosa, fructosa, histamina, frutos secos...). Respondes en español, de forma clara y breve, con listas cuando ayude. Siempre recuerdas que no das diagnóstico médico y recomiendas consultar a un profesional.";

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Proxy genérico: evita problemas de CORS en el navegador y
// permite usar las claves del .env sin exponerlas en el frontend.
app.post("/api/chat", async (req, res) => {
  try {
    const { provider, model, message, apiKey } = req.body || {};
    if (!provider || !message) return res.status(400).send("Faltan provider o message");

    const key = (apiKey || "").trim() || SERVER_KEYS[provider] || "";
    if (!key) return res.status(400).send(`Sin API key para ${provider}. Añádela en la app o en el .env`);

    let answer = "";

    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 600, system: SYSTEM_PROMPT, messages: [{ role: "user", content: message }] }),
      });
      if (!r.ok) return res.status(r.status).send(await r.text());
      const data = await r.json();
      answer = (data.content || []).map((b) => b.text || "").join("\n").trim();
    } else if (provider === "gemini") {
      const m = model || "gemini-1.5-flash";
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nPregunta: ${message}` }] }] }),
        }
      );
      if (!r.ok) return res.status(r.status).send(await r.text());
      const data = await r.json();
      answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } else {
      // Todos los compatibles con la API de OpenAI
      const endpoints = {
        groq: "https://api.groq.com/openai/v1/chat/completions",
        openai: "https://api.openai.com/v1/chat/completions",
        mistral: "https://api.mistral.ai/v1/chat/completions",
        cohere: "https://api.cohere.com/v2/chat",
        together: "https://api.together.xyz/v1/chat/completions",
        openrouter: "https://openrouter.ai/api/v1/chat/completions",
        deepseek: "https://api.deepseek.com/chat/completions",
        xai: "https://api.x.ai/v1/chat/completions",
        perplexity: "https://api.perplexity.ai/chat/completions",
      };
      const url = endpoints[provider];
      if (!url) return res.status(400).send(`Proveedor no soportado: ${provider}`);
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = "http://localhost:3000";
        headers["X-Title"] = "Intolerancias App";
      }
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          temperature: 0.4,
          max_tokens: 600,
        }),
      });
      if (!r.ok) return res.status(r.status).send(await r.text());
      const data = await r.json();
      answer = data.choices?.[0]?.message?.content?.trim() || "";
    }

    res.json({ answer: answer || "Sin respuesta del modelo." });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Intolerancias IA en http://localhost:${PORT}`);
  console.log(`   Proveedores con clave en .env: ${Object.entries(SERVER_KEYS).filter(([, v]) => v).map(([k]) => k).join(", ") || "(ninguno, usa la pestaña API Keys)"}`);
});
