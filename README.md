# intolerancias · Asistente IA + gestión de API keys

Asistente de intolerancias alimentarias con **gestión de API keys de Groq y todos los demás proveedores** en un solo lugar.

## ✨ Qué incluye

- 🔑 **Añadir / editar / borrar API keys** de 11 proveedores:
  - ⚡ **Groq** (`gsk_…`) — gratis y rapidísima, ideal para empezar
  - 🧠 OpenAI, 🟠 Anthropic Claude, ✨ Google Gemini, 🇫🇷 Mistral AI, 🌀 Cohere, 🤝 Together AI, 🧭 OpenRouter, 🐋 DeepSeek, ✖️ xAI (Grok), 🔎 Perplexity
- 👁️ Mostrar / ocultar clave, validación de formato (`gsk_`, `sk-`, `sk-ant-`, `AIza`…), botón **“Conseguir key ↗”** con enlace oficial
- 🔌 **Probar conexión** contra la API real de cada proveedor
- ▶ **Usar en chat**: marca un proveedor como activo y pregunta en el Asistente
- 💬 Chat de intolerancias que funciona con la clave activa (vía llamada directa o vía proxy Node)
- 📤 **Exportar a `.env`** / JSON, ⬆️ importar JSON, 🗑️ borrar todas
- 💾 Las claves se guardan **solo en tu navegador** (`localStorage`). Nada se sube a ningún servidor propio
- 🌙 Tema claro / oscuro, diseño responsive, 100 % estático (funciona abriendo `index.html`)

## 🚀 Uso rápido (solo frontend)

1. Abre `index.html` en tu navegador (o sírvelo con cualquier servidor estático).
2. Ve a la pestaña **🔑 API Keys**.
3. Pulsa **Añadir** en **Groq** → crea tu clave gratis en <https://console.groq.com/keys> (empieza por `gsk_`) → pégala → **Guardar clave**.
4. Repite para OpenAI, Anthropic, Gemini o los demás si quieres.
5. Vuelve a **💬 Asistente**, elige proveedor y modelo, y pregunta. Ej.: *“¿La avena tiene gluten?”*

> ⚠️ Esto no es consejo médico. Consulta siempre a un profesional sanitario.

## 🖥️ Uso con proxy Node (recomendado, evita CORS)

Algunos proveedores (Anthropic, OpenAI…) bloquean llamadas directas desde el navegador (CORS). El proxy `server.js` lo resuelve y además permite usar claves del servidor:

```bash
npm install
cp .env.example .env   # rellena GROQ_API_KEY=... etc.
npm start
# abre http://localhost:3000
```

La app detecta automáticamente el proxy (`/api/health`) y lo usa para el chat.

| Variable en `.env`     | Proveedor      |
|------------------------|----------------|
| `GROQ_API_KEY`         | Groq           |
| `OPENAI_API_KEY`       | OpenAI         |
| `ANTHROPIC_API_KEY`    | Anthropic      |
| `GEMINI_API_KEY`       | Google Gemini  |
| `MISTRAL_API_KEY`      | Mistral AI     |
| `COHERE_API_KEY`       | Cohere         |
| `TOGETHER_API_KEY`     | Together AI    |
| `OPENROUTER_API_KEY`   | OpenRouter     |
| `DEEPSEEK_API_KEY`     | DeepSeek       |
| `XAI_API_KEY`          | xAI / Grok     |
| `PERPLEXITY_API_KEY`   | Perplexity     |

## 📁 Estructura

```text
index.html      → UI (pestañas Asistente + API Keys, modal añadir/editar)
styles.css      → estilos modernos (claro/oscuro, responsive)
app.js          → lógica: PROVIDERS, localStorage, modal, test, chat
server.js       → proxy opcional Express (/api/chat, /api/health) + estáticos
package.json    → deps: express, cors, dotenv
.env.example    → plantilla de las 11 claves
```

## 🔒 Seguridad

- El `.env` está en `.gitignore`: nunca subas claves reales.
- En el navegador, las claves viven en `localStorage` (`intolerancias_api_keys_v1`). Para limpiarlas usa **Borrar todas** o borra los datos del sitio.
- Para producción, guarda las claves solo en el servidor (variables de entorno) y no las expongas en el frontend.

## 🧪 Probar

- **Frontend**: abre `index.html` → API Keys → Añadir → Probar.
- **Servidor**: `npm install && npm start` → abre `http://localhost:3000/api/health` (debe devolver `{"ok":true}`).
