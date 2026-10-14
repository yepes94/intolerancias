/* Intolerancias · js/home.js — pantalla Home + registro de tiles de registro rápido + tema.
 * Las features registran su tile con IntolHome.registerTile({...}) (ver docs/diseno.md). */
(function () {
  "use strict";

  const THEME_KEY = "intol.theme";
  const DAY = 86400e3;
  const tiles = new Map();
  let pending = false;

  const TIPS = [
    "Registra lo que comes y cómo te sienta para descubrir qué alimentos te sientan mal.",
    "Cuando notes molestias, cuéntalo en el diario: se cruza con lo que comiste en las 24 h anteriores.",
    "Una foto del plato ayuda a la IA a detectar ingredientes escondidos.",
    "Prueba a quitar un solo alimento cada vez: así sabrás cuál es el culpable.",
    "Beber agua a lo largo del día ayuda a tu digestión.",
    "Comer despacio y masticar bien reduce gases e hinchazón.",
    "La constancia es la clave: unos minutos al día bastan para ver patrones."
  ];

  const PLACEHOLDERS = [
    { id: "deposicion", order: 10, emoji: "💩", title: "Deposición", desc: "Registra tus deposiciones a lo largo del día" },
    { id: "animo", order: 20, emoji: "😌", title: "Ánimo y sueño", desc: "Registra tu ánimo y la calidad del sueño" },
    { id: "comida", order: 30, emoji: "🥣", title: "Comida", desc: "Registra los alimentos que has comido" },
    { id: "bebida", order: 40, emoji: "☕", title: "Bebida", desc: "Registra lo que has bebido" }
  ];

  function registerTile(def) {
    if (!def || !def.id) return;
    const prev = tiles.get(def.id) || {};
    tiles.set(def.id, { ...prev, ...def, order: def.order != null ? def.order : (prev.order != null ? prev.order : 100) });
    scheduleRender();
  }
  PLACEHOLDERS.forEach(registerTile);

  const esc = (s) => String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /** Lunes de la semana de `now` (00:00 local). */
  function weekStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  /** Días L–D de la semana actual con nº de registros de todas las tiles. */
  function week(now, list) {
    const start = weekStart(now);
    const counts = {};
    for (const t of list) {
      if (typeof t.records !== "function") continue;
      let ts = [];
      try { ts = t.records() || []; } catch { ts = []; }
      for (const x of ts) { const k = dayKey(x); counts[k] = (counts[k] || 0) + 1; }
    }
    const today = dayKey(now);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const k = dayKey(d.getTime());
      out.push({ key: k, date: d, letter: "LMXJVSD"[i], count: counts[k] || 0, today: k === today, future: k > today });
    }
    return out;
  }

  function tipFor(now) {
    return TIPS[Math.floor(weekStart(now) / DAY + new Date(now).getDay()) % TIPS.length];
  }

  function sortedTiles() {
    return [...tiles.values()].sort((a, b) => a.order - b.order);
  }

  function scheduleRender() {
    if (pending || typeof document === "undefined") return;
    pending = true;
    queueMicrotask(() => { pending = false; render(); });
  }

  function render() {
    if (typeof document === "undefined") return;
    const root = document.getElementById("homeTiles");
    if (!root) return;
    const now = Date.now();
    const list = sortedTiles();

    document.getElementById("homeDate").textContent = "Hoy, " +
      new Date(now).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");

    const fmt = (d) => d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("homeWeek").innerHTML = week(now, list).map((d) =>
      "<li class='week-day" + (d.today ? " is-today" : "") + (d.count ? " has-records" : "") + (d.future ? " is-future" : "") + "'>" +
      "<span class='week-letter' aria-hidden='true'>" + d.letter + "</span>" +
      "<span class='week-dot' aria-hidden='true'></span>" +
      "<span class='sr-only'>" + esc(fmt(d.date)) + (d.today ? " (hoy)" : "") + ": " +
      (d.count ? d.count + " registro(s)" : "sin registros") + "</span></li>").join("");

    document.getElementById("homeTip").textContent = tipFor(now);

    root.innerHTML = "";
    for (const t of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile" + (t.wide ? " is-wide" : "");
      b.dataset.tile = t.id;
      const soon = typeof t.onOpen !== "function";
      if (soon) b.setAttribute("aria-disabled", "true");
      b.innerHTML = "<span class='tile-emoji' aria-hidden='true'>" + esc(t.emoji) + "</span>" +
        "<span class='tile-text'><span class='tile-title'>" + esc(t.title) + "</span>" +
        "<span class='tile-desc'>" + esc(t.desc) + "</span></span>" +
        (soon ? "<span class='tile-badge'>Próximamente</span>" : "");
      b.addEventListener("click", () => {
        if (soon) { if (window.IntolToast) window.IntolToast(t.title + ": próximamente"); return; }
        t.onOpen();
      });
      root.appendChild(b);
    }
  }

  function showTab(name) {
    const b = typeof document !== "undefined" && document.querySelector('.tab[data-tab="' + name + '"]');
    if (b) b.click();
  }

  // ---------- tema (Sistema / Claro / Oscuro) ----------
  function getTheme() {
    try { const v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : "system"; }
    catch { return "system"; }
  }
  function applyTheme(v) {
    const root = document.documentElement;
    if (v === "light" || v === "dark") root.dataset.theme = v; else delete root.dataset.theme;
    const dark = v === "dark" || (v === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = dark ? "#121210" : "#f4f0e7"; m.removeAttribute("media"); });
  }
  function setTheme(v) {
    try { if (v === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch { /* sin storage */ }
    applyTheme(v);
  }
  if (typeof document !== "undefined") {
    applyTheme(getTheme());
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll("input[name='theme']").forEach((r) => {
        r.checked = r.value === getTheme();
        r.addEventListener("change", () => setTheme(r.value));
      });
    });
  }

  window.IntolHome = { registerTile, refresh: render, render, showTab, tips: TIPS, week, weekStart, dayKey, tipFor, tiles: sortedTiles, getTheme, setTheme };
})();
