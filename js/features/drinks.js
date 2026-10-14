/* Intolerancias · js/features/drinks.js
 *
 * Registro de bebidas (lógica pura, sin DOM, testeable en Node):
 *   - TYPES: botones rápidos con su mapeo a componentes de IntolData.ONSET_WINDOWS,
 *     para que las bebidas cuenten en el diario, la dieta y el Resumen.
 *   - SIZES: vaso (250 ml), taza (200 ml) o ml libres.
 *   - makeDrink: objeto bebida con forma de ingesta (id, createdAt, description,
 *     ingredients con source "drink"), para cruzarla con las comidas.
 *   - Hidratación: solo el agua cuenta para el objetivo diario (ml/día configurable).
 *   - registerHomeTile: enganche al tile «Bebida» del Home (docs/diseno.md);
 *     si el Home aún no existe (IntolHome ausente), no hace nada y la feature
 *     sigue funcionando desde su tarjeta de Registrar. */
(function () {
  "use strict";

  // Mapeo a claves de ONSET_WINDOWS (lo comprueba tests/drinks.test.mjs).
  // Refresco y zumo → fructosa (azúcares); cerveza → alcohol + gluten;
  // vino tinto → alcohol + histamina; vegetal (soja/avena) → soja.
  const TYPES = [
    { id: "agua",     emoji: "💧", label: "Agua",            components: [],                    size: "vaso" },
    { id: "cafe",     emoji: "☕", label: "Café",            components: ["cafeina"],           size: "taza" },
    { id: "te",       emoji: "🍵", label: "Té / infusión",  components: ["cafeina"],           size: "taza" },
    { id: "leche",    emoji: "🥛", label: "Leche",           components: ["lactosa"],           size: "vaso" },
    { id: "vegetal",  emoji: "🌱", label: "Bebida vegetal",  components: ["soja"],              size: "vaso" },
    { id: "refresco", emoji: "🥤", label: "Refresco",        components: ["fructosa"],          size: "vaso" },
    { id: "zumo",     emoji: "🧃", label: "Zumo",            components: ["fructosa"],          size: "vaso" },
    { id: "cerveza",  emoji: "🍺", label: "Cerveza",         components: ["alcohol", "gluten"], size: "vaso" },
    { id: "vino",     emoji: "🍷", label: "Vino",            components: ["alcohol", "histamina"], size: "copa" },
    { id: "destilado", emoji: "🥃", label: "Destilado",      components: ["alcohol"],           size: "chupito" },
    { id: "otra",     emoji: "🧋", label: "Otra",            components: [],                    size: "vaso" }
  ];

  const SIZES = [
    { id: "vaso",    label: "Vaso",    ml: 250 },
    { id: "taza",    label: "Taza",    ml: 200 },
    { id: "copa",    label: "Copa",    ml: 150 },
    { id: "chupito", label: "Chupito", ml: 40 },
    { id: "ml",      label: "ml",      ml: null }
  ];

  const DEFAULT_GOAL_ML = 2000;
  const MIN_ML = 20, MAX_ML = 2000;

  function typeById(id) {
    return TYPES.find((t) => t.id === id) || null;
  }

  function sizeById(id) {
    return SIZES.find((s) => s.id === id) || null;
  }

  function clipMl(v, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.max(MIN_ML, Math.min(MAX_ML, n));
  }

  /** Objetivo diario de agua saneado (250–5000 ml, por defecto 2000). */
  function sanitizeGoal(v) {
    const n = Math.round(Number(v));
    return n >= 250 && n <= 5000 ? n : DEFAULT_GOAL_ML;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /** "Café · taza (200 ml)" / "Cerveza · 330 ml". */
  function describe(type, ml, sizeId) {
    const s = sizeById(sizeId);
    const qty = s && s.ml != null && ml === s.ml
      ? s.label.toLowerCase() + " (" + ml + " ml)"
      : ml + " ml";
    return type.label + " · " + qty;
  }

  /** Bebida con forma de ingesta: se cruza con comidas en diario/dieta/resumen. */
  function makeDrink(o) {
    const type = typeById(o && o.type) || typeById("otra");
    const size = sizeById(o && o.sizeId) || null;
    const ml = size && size.ml != null && (o.ml == null || o.ml === "")
      ? size.ml
      : clipMl(o && o.ml, size ? (size.ml || 250) : 250);
    const at = isFinite(Number(o && o.at)) ? Number(o.at) : Date.now();
    return {
      id: (o && o.id) || ("drink-" + at + "-" + Math.random().toString(36).slice(2, 8)),
      kind: "drink",
      createdAt: at,
      type: type.id,
      emoji: type.emoji,
      ml,
      description: describe(type, ml, size ? size.id : "ml"),
      ingredients: type.components.map((id) => ({ id, source: "drink" }))
    };
  }

  function drinksOnDay(drinks, ts) {
    const k = dayKey(ts == null ? Date.now() : ts);
    return (drinks || []).filter((d) => dayKey(d.createdAt) === k);
  }

  /** Solo el agua hidrata para el objetivo (el resto suma componentes, no ml). */
  function waterMl(drinks, ts) {
    return drinksOnDay(drinks, ts).reduce((a, d) => a + (d.type === "agua" ? (Number(d.ml) || 0) : 0), 0);
  }

  function hydration(drinks, goalMl, ts) {
    const goal = sanitizeGoal(goalMl);
    const ml = waterMl(drinks, ts);
    return { ml, goal, pct: Math.min(100, Math.round(ml / goal * 100)), remaining: Math.max(0, goal - ml) };
  }

  /** Componentes aportados hoy por bebidas: { id: { n, ml } }. */
  function componentsOnDay(drinks, ts) {
    const acc = {};
    for (const d of drinksOnDay(drinks, ts)) {
      for (const ing of d.ingredients || []) {
        const a = acc[ing.id] = acc[ing.id] || { n: 0, ml: 0 };
        a.n++;
        a.ml += Number(d.ml) || 0;
      }
    }
    return acc;
  }

  /** Enganche al tile «Bebida» del Home (docs/diseno.md, js/home.js).
   *  Sin Home (IntolHome ausente) no hace nada: la tarjeta de Registrar
   *  sigue siendo la vía de registro. `open` abre el registro, `records`
   *  devuelve los createdAt de las bebidas para la tira semanal. */
  function registerHomeTile(open, records) {
    try {
      const H = typeof window !== "undefined" && window.IntolHome;
      if (!H || typeof H.registerTile !== "function") return false;
      H.registerTile({
        id: "bebida",
        emoji: "🥤",
        title: "Bebida",
        desc: "Registra lo que bebes",
        onOpen: open,
        records
      });
      return true;
    } catch { return false; }
  }

  const api = {
    TYPES, SIZES, DEFAULT_GOAL_ML, MIN_ML, MAX_ML,
    typeById, sizeById, sanitizeGoal, dayKey, describe, makeDrink,
    drinksOnDay, waterMl, hydration, componentsOnDay, registerHomeTile
  };

  if (typeof window !== "undefined" && window) window.IntolDrinks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
