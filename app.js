/* Intolerancias · Gestión de API keys multi-proveedor (Groq y demás) */

export const PROVIDERS = [
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    color: "linear-gradient(135deg,#f97316,#ef4444)",
    placeholder: "gsk_…",
    prefixHint: "Empieza por gsk_",
    testPrefix: "gsk_",
    keyUrl: "https://console.groq.com/keys",
    keyUrlLabel: "console.groq.com/keys",
    free: true,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    defaultModel: "llama-3.3-70b-versatile",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    kind: "openai-compatible",
    desc: "Gratis y rapidísima. Ideal para empezar.",
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: "🧠",
    color: "linear-gradient(135deg,#10a37f,#0ea5e9)",
    placeholder: "sk-…",
    prefixHint: "Empieza por sk-",
    testPrefix: "sk-",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "platform.openai.com/api-keys",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    defaultModel: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
    kind: "openai-compatible",
    desc: "GPT-4o y familia. Requiere saldo.",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    icon: "🟠",
    color: "linear-gradient(135deg,#f59e0b,#d97706)",
    placeholder: "sk-ant-…",
    prefixHint: "Empieza por sk-ant-",
    testPrefix: "sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "console.anthropic.com",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    defaultModel: "claude-3-5-sonnet-20241022",
    endpoint: "https://api.anthropic.com/v1/messages",
    kind: "anthropic",
    desc: "Claude 3.5, excelente razonamiento.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    icon: "✨",
    color: "linear-gradient(135deg,#4285f4,#9b72cb)",
    placeholder: "AIza…",
    prefixHint: "Empieza por AIza",
    testPrefix: "AIza",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyUrlLabel: "aistudio.google.com",
    free: true,
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
    defaultModel: "gemini-1.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    kind: "gemini",
    desc: "Generoso plan gratuito de Google.",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    icon: "🇫🇷",
    color: "linear-gradient(135deg,#ff7000,#ffad00)",
    placeholder: "…",
    prefixHint: "Clave de console.mistral.ai",
    testPrefix: "",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyUrlLabel: "console.mistral.ai",
    models: ["mistral-large-latest", "mistral-small-latest", "mistral-medium-latest"],
    defaultModel: "mistral-small-latest",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    modelsEndpoint: "https://api.mistral.ai/v1/models",
    kind: "openai-compatible",
    desc: "Modelos europeos abiertos.",
  },
  {
    id: "cohere",
    name: "Cohere",
    icon: "🌀",
    color: "linear-gradient(135deg,#39594d,#7bb89f)",
    placeholder: "…",
    prefixHint: "Clave de dashboard.cohere.com",
    testPrefix: "",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    keyUrlLabel: "dashboard.cohere.com",
    models: ["command-r-plus", "command-r", "command-light"],
    defaultModel: "command-r-plus",
    endpoint: "https://api.cohere.com/v2/chat",
    kind: "openai-compatible",
    desc: "Command R, bueno en RAG.",
  },
  {
    id: "together",
    name: "Together AI",
    icon: "🤝",
    color: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
    placeholder: "…",
    prefixHint: "Clave de api.together.xyz",
    testPrefix: "",
    keyUrl: "https://api.together.xyz/settings/api-keys",
    keyUrlLabel: "api.together.xyz",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    endpoint: "https://api.together.xyz/v1/chat/completions",
    modelsEndpoint: "https://api.together.xyz/v1/models",
    kind: "openai-compatible",
    desc: "Cientos de modelos open-source.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: "🧭",
    color: "linear-gradient(135deg,#6366f1,#a855f7)",
    placeholder: "sk-or-…",
    prefixHint: "Empieza por sk-or-",
    testPrefix: "sk-or-",
    keyUrl: "https://openrouter.ai/keys",
    keyUrlLabel: "openrouter.ai/keys",
    models: ["meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    kind: "openai-compatible",
    desc: "Un gateway para todos los modelos.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🐋",
    color: "linear-gradient(135deg,#0ea5e9,#0369a1)",
    placeholder: "sk-…",
    prefixHint: "Empieza por sk-",
    testPrefix: "sk-",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyUrlLabel: "platform.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    endpoint: "https://api.deepseek.com/chat/completions",
    modelsEndpoint: "https://api.deepseek.com/models",
    kind: "openai-compatible",
    desc: "Muy barato y potente.",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    icon: "✖️",
    color: "linear-gradient(135deg,#111827,#4b5563)",
    placeholder: "xai-…",
    prefixHint: "Empieza por xai-",
    testPrefix: "xai-",
    keyUrl: "https://console.x.ai",
    keyUrlLabel: "console.x.ai",
    models: ["grok-beta", "grok-2-1212"],
    defaultModel: "grok-beta",
    endpoint: "https://api.x.ai/v1/chat/completions",
    modelsEndpoint: "https://api.x.ai/v1/models",
    kind: "openai-compatible",
    desc: "Grok, con acceso a X.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    icon: "🔎",
    color: "linear-gradient(135deg,#14b8a6,#0d9488)",
    placeholder: "pplx-…",
    prefixHint: "Empieza por pplx-",
    testPrefix: "pplx-",
    keyUrl: "https://www.perplexity.ai/settings/api",
    keyUrlLabel: "perplexity.ai/settings/api",
    models: ["llama-3.1-sonar-small-128k-online", "llama-3.1-sonar-large-128k-online"],
    defaultModel: "llama-3.1-sonar-small-128k-online",
    endpoint: "https://api.perplexity.ai/chat/completions",
    kind: "openai-compatible",
    desc: "Respuestas con búsqueda web.",
  },
];

const LS_KEYS = "intolerancias_api_keys_v1";
const LS_PROVIDER = "intolerancias_active_provider";
const LS_MODEL = "intolerancias_active_model";
const LS_THEME = "intolerancias_theme";

// ── Estado ──────────────────────────────────────────────
let keys = loadKeys();
let editingProvider = null;

function loadKeys() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS) || "{}");
  } catch {
    return {};
  }
}
function saveKeys() {
  localStorage.setItem(LS_KEYS, JSON.stringify(keys));
}
function getKey(id) {
  return (keys[id] || "").trim();
}
function maskKey(k) {
  if (!k) return "•••••••• sin configurar";
  if (k.length <= 12) return k.slice(0, 4) + "••••••••";
  return k.slice(0, 7) + "••••••••" + k.slice(-4);
}
function configuredCount() {
  return PROVIDERS.filter((p) => getKey(p.id)).length;
}

// ── Utilidades UI ───────────────────────────────────────
const $ = (s) => document.querySelector(s);
function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toastStack").appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ── Tabs ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
document.querySelectorAll("[data-goto]").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.goto))
);
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
}

// ── Tema ────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(LS_THEME) || "dark";
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  $("#themeBtn").textContent = saved === "light" ? "🌙" : "☀️";
}
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(LS_THEME, next);
  $("#themeBtn").textContent = next === "light" ? "🌙" : "☀️";
});

// ── Tarjetas de proveedores ─────────────────────────────
function renderProviders(filter = "") {
  const grid = $("#providersGrid");
  grid.innerHTML = "";
  const q = filter.trim().toLowerCase();
  PROVIDERS.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q)).forEach((p) => {
    const key = getKey(p.id);
    const card = document.createElement("article");
    card.className = "provider-card";
    card.innerHTML = `
      <div class="provider-top">
        <div class="provider-icon" style="background:${p.color}">${p.icon}</div>
        <div>
          <h3>${p.name} ${p.free ? '<span title="Plan gratuito disponible">🆓</span>' : ""}</h3>
          <small>${p.desc}</small>
        </div>
        <span class="status-dot ${key ? "on" : "off"}">${key ? "● Configurada" : "○ Sin clave"}</span>
      </div>
      <div class="key-preview">${key ? maskKey(key) : "Sin configurar — pulsa Añadir"}</div>
      <div class="provider-meta">
        <span>🔑 <code>${p.prefixHint}</code></span>
        <a href="${p.keyUrl}" target="_blank" rel="noopener">Conseguir key ↗</a>
      </div>
      <div class="provider-actions">
        <button class="btn small primary" data-act="edit">✏️ ${key ? "Editar" : "Añadir"}</button>
        ${key ? `<button class="btn small ghost" data-act="test">🔌 Probar</button>
                 <button class="btn small ghost" data-act="use">▶ Usar en chat</button>
                 <button class="btn small danger-ghost" data-act="del">Borrar</button>` : ""}
      </div>`;
    card.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(p.id));
    const testBtn = card.querySelector('[data-act="test"]');
    if (testBtn) testBtn.addEventListener("click", (e) => testConnection(p, e.currentTarget));
    const useBtn = card.querySelector('[data-act="use"]');
    if (useBtn)
      useBtn.addEventListener("click", () => {
        localStorage.setItem(LS_PROVIDER, p.id);
        localStorage.setItem(LS_MODEL, p.defaultModel);
        syncChatSelectors();
        switchTab("asistente");
        toast(`Proveedor activo: ${p.name}`, "success");
      });
    const delBtn = card.querySelector('[data-act="del"]');
    if (delBtn)
      delBtn.addEventListener("click", () => {
        if (!confirm(`¿Borrar la clave de ${p.name}?`)) return;
        delete keys[p.id];
        saveKeys();
        refreshAll();
        toast(`Clave de ${p.name} eliminada`);
      });
    grid.appendChild(card);
  });
  $("#keysBadge").textContent = `${configuredCount()}/${PROVIDERS.length}`;
}

$("#searchProvider").addEventListener("input", (e) => renderProviders(e.target.value));

// ── Modal añadir / editar ───────────────────────────────
function openModal(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return;
  editingProvider = p;
  $("#modalProviderIcon").textContent = p.icon;
  $("#modalProviderIcon").style.background = p.color;
  const has = !!getKey(p.id);
  $("#modalTitle").textContent = has ? `Editar clave de ${p.name}` : `Añadir clave de ${p.name}`;
  $("#modalSubtitle").textContent = p.desc;
  $("#modalKeyInput").value = getKey(p.id);
  $("#modalKeyInput").type = "password";
  $("#modalHint").textContent = `Formato esperado: ${p.prefixHint}. Consíguela en ${p.keyUrlLabel}.`;
  $("#modalHelpLink").href = p.keyUrl;
  $("#modalDelete").hidden = !has;
  $("#modalValidation").textContent = "";
  $("#modalValidation").className = "validation";
  $("#modalBackdrop").hidden = false;
  setTimeout(() => $("#modalKeyInput").focus(), 50);
  validateModalInput();
}
function closeModal() {
  $("#modalBackdrop").hidden = true;
  editingProvider = null;
}
$("#modalClose").addEventListener("click", closeModal);
$("#modalCancel").addEventListener("click", closeModal);
$("#modalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "modalBackdrop") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modalBackdrop").hidden) closeModal();
});
$("#modalToggleVisible").addEventListener("click", () => {
  const i = $("#modalKeyInput");
  i.type = i.type === "password" ? "text" : "password";
});
$("#modalKeyInput").addEventListener("input", validateModalInput);
function validateModalInput() {
  if (!editingProvider) return true;
  const v = $("#modalKeyInput").value.trim();
  const el = $("#modalValidation");
  if (!v) {
    el.textContent = "";
    return false;
  }
  if (editingProvider.testPrefix && !v.startsWith(editingProvider.testPrefix)) {
    el.textContent = `⚠️ Normalmente empieza por “${editingProvider.testPrefix}”`;
    el.className = "validation warn";
    return true; // permitir guardar igualmente
  }
  if (v.length < 10) {
    el.textContent = "⚠️ Parece demasiado corta";
    el.className = "validation warn";
    return true;
  }
  el.textContent = "✓ Formato correcto";
  el.className = "validation ok";
  return true;
}
$("#modalSave").addEventListener("click", () => {
  if (!editingProvider) return;
  const v = $("#modalKeyInput").value.trim();
  if (!v) {
    toast("Pega primero tu API key", "error");
    return;
  }
  keys[editingProvider.id] = v;
  saveKeys();
  closeModal();
  refreshAll();
  toast(`✅ Clave de ${editingProvider.name} guardada`, "success");
});
$("#modalDelete").addEventListener("click", () => {
  if (!editingProvider) return;
  delete keys[editingProvider.id];
  saveKeys();
  const name = editingProvider.name;
  closeModal();
  refreshAll();
  toast(`Clave de ${name} eliminada`);
});

// ── Probar conexión ─────────────────────────────────────
async function testConnection(p, btn) {
  const key = getKey(p.id);
  if (!key) return toast("Primero añade la clave", "error");
  const old = btn.textContent;
  btn.textContent = "⏳ Probando…";
  btn.disabled = true;
  try {
    if (p.kind === "openai-compatible" && p.modelsEndpoint) {
      const headers = { Authorization: `Bearer ${key}` };
      if (p.id === "openrouter") {
        headers["HTTP-Referer"] = location.origin;
        headers["X-Title"] = "Intolerancias App";
      }
      const res = await fetch(p.modelsEndpoint, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 160))}`);
      toast(`✅ ${p.name}: conexión OK`, "success");
    } else if (p.kind === "gemini") {
      const res = await fetch(`${p.endpoint}?key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(`✅ ${p.name}: conexión OK`, "success");
    } else if (p.kind === "anthropic") {
      // Anthropic bloquea CORS en navegador: validamos formato y avisamos del proxy
      if (!key.startsWith("sk-ant-")) throw new Error("La clave no empieza por sk-ant-");
      toast(`✅ ${p.name}: formato válido. Usa «npm start» para llamada real (CORS).`, "success");
    } else {
      // Cohere sin endpoint de modelos público: validación básica
      if (key.length < 10) throw new Error("Clave demasiado corta");
      toast(`✅ ${p.name}: formato válido. Usa el chat para prueba real.`, "success");
    }
  } catch (err) {
    console.warn(err);
    toast(`❌ ${p.name}: ${err.message}. Revisa la clave o usa «npm start».`, "error");
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
}

// ── Exportar / importar / borrar ────────────────────────
function download(filename, content, mime = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportEnv() {
  const lines = ["# Intolerancias · exportado desde la app", `# Fecha: ${new Date().toISOString()}`, ""];
  PROVIDERS.forEach((p) => {
    lines.push(`# ${p.name} — ${p.keyUrl}`, `${p.id.toUpperCase()}_API_KEY=${getKey(p.id) || ""}`, "");
  });
  download(".env", lines.join("\n"));
  toast("📤 .env descargado", "success");
}
function exportJson() {
  download("intolerancias-api-keys.json", JSON.stringify({ exportedAt: new Date().toISOString(), keys }, null, 2), "application/json");
  toast("⬇️ JSON descargado", "success");
}
$("#exportEnvBtn").addEventListener("click", exportEnv);
$("#exportEnvBtn2").addEventListener("click", exportEnv);
$("#exportJsonBtn").addEventListener("click", exportJson);
$("#importJsonBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      const incoming = data.keys || data;
      let n = 0;
      PROVIDERS.forEach((p) => {
        if (typeof incoming[p.id] === "string" && incoming[p.id].trim()) {
          keys[p.id] = incoming[p.id].trim();
          n++;
        }
      });
      saveKeys();
      refreshAll();
      toast(`⬆️ ${n} claves importadas`, "success");
    } catch {
      toast("JSON no válido", "error");
    }
  };
  r.readAsText(f);
  e.target.value = "";
});
$("#clearAllBtn").addEventListener("click", () => {
  if (!confirm("¿Borrar TODAS las claves guardadas en este navegador?")) return;
  keys = {};
  saveKeys();
  refreshAll();
  toast("Todas las claves eliminadas");
});

// ── Chat ────────────────────────────────────────────────
function syncChatSelectors() {
  const provSel = $("#chatProvider");
  const modelSel = $("#chatModel");
  provSel.innerHTML = "";
  PROVIDERS.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.icon} ${p.name}${getKey(p.id) ? "" : " (sin clave)"}`;
    provSel.appendChild(o);
  });
  const savedProv = localStorage.getItem(LS_PROVIDER) || "groq";
  provSel.value = PROVIDERS.some((p) => p.id === savedProv) ? savedProv : "groq";
  fillModels(provSel.value);
  updateProviderStatus();

  // chips rápidos
  const qp = $("#quickProviders");
  qp.innerHTML = "";
  ["groq", "openai", "anthropic", "gemini", "openrouter"].forEach((id) => {
    const p = PROVIDERS.find((x) => x.id === id);
    const b = document.createElement("button");
    b.className = `quick-chip ${getKey(id) ? "configured" : ""}`;
    b.textContent = `${p.icon} ${p.name} ${getKey(id) ? "✓" : "+"}`;
    b.addEventListener("click", () => {
      if (getKey(id)) {
        provSel.value = id;
        localStorage.setItem(LS_PROVIDER, id);
        fillModels(id);
        updateProviderStatus();
      } else openModal(id);
    });
    qp.appendChild(b);
  });
}
function fillModels(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const modelSel = $("#chatModel");
  modelSel.innerHTML = "";
  (p?.models || []).forEach((m) => {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    modelSel.appendChild(o);
  });
  const savedModel = localStorage.getItem(LS_MODEL);
  modelSel.value = p.models.includes(savedModel) ? savedModel : p.defaultModel;
}
function updateProviderStatus() {
  const id = $("#chatProvider").value;
  const p = PROVIDERS.find((x) => x.id === id);
  const el = $("#chatProviderStatus");
  if (getKey(id)) {
    el.className = "provider-status ok";
    el.textContent = `● ${p.name} lista`;
  } else {
    el.className = "provider-status missing";
    el.textContent = `○ Sin clave de ${p?.name || id}`;
  }
}
$("#chatProvider").addEventListener("change", (e) => {
  localStorage.setItem(LS_PROVIDER, e.target.value);
  fillModels(e.target.value);
  localStorage.setItem(LS_MODEL, $("#chatModel").value);
  updateProviderStatus();
});
$("#chatModel").addEventListener("change", (e) => localStorage.setItem(LS_MODEL, e.target.value));

function addMsg(role, html) {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="avatar">${role === "user" ? "🧑" : "🤖"}</div><div class="bubble">${html}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#chatText").value.trim();
  if (!text) return;
  const providerId = $("#chatProvider").value;
  const model = $("#chatModel").value;
  const p = PROVIDERS.find((x) => x.id === providerId);
  const key = getKey(providerId);
  if (!key) {
    addMsg("assistant", `⚠️ No tienes clave de <strong>${p.name}</strong>. <button class="linklike" data-goto="keys">Añádela en 🔑 API Keys</button>.`);
    bindGotoLinks();
    openModal(providerId);
    return;
  }
  $("#chatText").value = "";
  addMsg("user", escapeHtml(text));
  const pending = addMsg("assistant", `<span class="typing"><span></span><span></span><span></span></span>`);
  $("#chatSend").disabled = true;
  try {
    const answer = await callAI(p, key, model, text);
    pending.querySelector(".bubble").innerHTML = escapeHtml(answer);
  } catch (err) {
    console.warn(err);
    pending.querySelector(".bubble").innerHTML =
      `❌ <strong>Error con ${p.name}:</strong> ${escapeHtml(err.message)}<br><br>Si ves un error de <code>CORS / Failed to fetch</code>, arranca el proxy con <code>npm install && npm start</code> y abre <code>http://localhost:3000</code>.`;
  } finally {
    $("#chatSend").disabled = false;
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  }
});
function bindGotoLinks() {
  document.querySelectorAll('[data-goto]:not([data-bound])').forEach((b) => {
    b.dataset.bound = "1";
    b.addEventListener("click", () => switchTab(b.dataset.goto));
  });
}

async function callAI(p, key, model, userText) {
  // 1) Intentar vía proxy local (evita CORS) si existe
  try {
    const probe = await fetch("/api/health").then((r) => r.ok).catch(() => false);
    if (probe) {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p.id, model, apiKey: key, message: userText }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 300));
      const data = await res.json();
      return data.answer;
    }
  } catch {
    // sin proxy → llamada directa
  }

  const system = "Eres un asistente experto en intolerancias alimentarias (gluten, lactosa, fructosa, histamina, frutos secos...). Respondes en español, de forma clara y breve, con listas cuando ayude. Siempre recuerdas que no das diagnóstico médico y recomiendas consultar a un profesional.";

  // 2) Llamada directa según tipo de proveedor
  if (p.kind === "openai-compatible") {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    if (p.id === "openrouter") {
      headers["HTTP-Referer"] = location.origin;
      headers["X-Title"] = "Intolerancias App";
    }
    const res = await fetch(p.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
        temperature: 0.4,
        max_tokens: 600,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "Sin respuesta del modelo.";
  }

  if (p.kind === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\nPregunta: ${userText}` }] }] }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Sin respuesta del modelo.";
  }

  if (p.kind === "anthropic") {
    const res = await fetch(p.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.content?.map((b) => b.text || "").join("\n").trim() || "Sin respuesta del modelo.";
  }

  throw new Error("Proveedor no soportado");
}

// ── Init ────────────────────────────────────────────────
function refreshAll() {
  keys = loadKeys();
  renderProviders($("#searchProvider").value || "");
  syncChatSelectors();
  bindGotoLinks();
}
initTheme();
refreshAll();
