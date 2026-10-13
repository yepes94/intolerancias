/* Intolerancias · js/diet.js
 *
 * Lógica pura de "Dieta de prueba con IA" (sin DOM, testeable en Node):
 *   - buildSignals(meals, checkins): resumen compacto para la IA + exclusiones.
 *   - localPlan(scope, slot, avoid): plan de ejemplo sin IA que respeta exclusiones.
 *   - conflicts(plan, avoid): platos que mencionan un componente excluido.
 *   - compare(plan, meals, checkins): bienestar con el plan vs. el resto.
 * Orientativo, no médico: no diagnostica ni sustituye a un profesional. */
(function () {
  "use strict";

  const D = () => window.IntolData;

  const SLOTS = ["desayuno", "comida", "merienda", "cena"];
  const SLOT_LABELS = { desayuno: "Desayuno", comida: "Comida", merienda: "Merienda", cena: "Cena" };

  // Síntomas que cuentan como "pesadez/malestar" para buscar señales.
  const TARGET_SYMPTOMS = ["hinchazón", "pesadez", "gases", "cansancio", "dolor abdominal", "náusea", "acidez", "diarrea"];

  const DISCLAIMER = "Dieta orientativa, no médica: no sustituye a un médico ni a un nutricionista. " +
    "Si sospechas una intolerancia, hazte pruebas de intolerancia con un profesional sanitario.";

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  function rawKeys(t) {
    const found = [];
    for (const [re, ing] of D().KEYWORDS) {
      if (re.test(t) && !found.includes(ing)) found.push(ing);
    }
    for (const [id, w] of Object.entries(D().ONSET_WINDOWS)) {
      if (!found.includes(id) && (new RegExp("\\b" + norm(id) + "\\b").test(t) || new RegExp("\\b" + norm(w.label) + "\\b").test(t))) {
        found.push(id);
      }
    }
    return found;
  }

  // Por tramo ("pan sin gluten", "yogur sin lactosa"): lo negado con "sin X"
  // no cuenta en ese tramo, pero sí en el resto del texto.
  function keysInText(text) {
    const found = [];
    for (const seg of norm(text).split(/[,;·\-—|()]|\by\b|\bcon\b/)) {
      const negated = [];
      const rest = seg.replace(/\bsin\s+([a-z]+(?:\s+[a-z]+)?)/g, (_, w) => { negated.push(...rawKeys(w)); return " "; });
      for (const k of rawKeys(rest)) if (!negated.includes(k) && !found.includes(k)) found.push(k);
    }
    return found;
  }

  function mealKeys(m) {
    const ids = new Set((m.ingredients || []).map((i) => i.id).filter((id) => D().ONSET_WINDOWS[id]));
    const comps = (m.analysis && Array.isArray(m.analysis.components)) ? m.analysis.components : [];
    for (const c of comps) for (const id of keysInText(c)) ids.add(id);
    return [...ids];
  }

  function doneFor(checkins, mealId) {
    return checkins.filter((c) => c.mealId === mealId && c.doneAt && c.feeling != null);
  }

  function isBad(avg, symptoms) {
    return avg <= 2.5 || symptoms.some((s) => TARGET_SYMPTOMS.includes(s));
  }

  /** Señales a partir de lo registrado: { suspects, avoid, recent, baseline, mealsWithData }. */
  function buildSignals(meals, checkins) {
    const rows = [];
    for (const m of meals) {
      const rel = doneFor(checkins, m.id);
      if (!rel.length) continue;
      const avg = rel.reduce((a, c) => a + c.feeling, 0) / rel.length;
      const symptoms = [...new Set(rel.flatMap((c) => c.symptoms || []))];
      rows.push({ m, keys: mealKeys(m), avg, symptoms, bad: isBad(avg, symptoms) });
    }
    const acc = {};
    for (const r of rows) {
      for (const k of r.keys) {
        const a = acc[k] = acc[k] || { n: 0, bad: 0, sym: {} };
        a.n++;
        if (r.bad) a.bad++;
        for (const s of r.symptoms) if (TARGET_SYMPTOMS.includes(s)) a.sym[s] = (a.sym[s] || 0) + 1;
      }
    }
    const suspects = [];
    for (const [id, a] of Object.entries(acc)) {
      const others = rows.filter((r) => !r.keys.includes(id));
      const rate = a.bad / a.n;
      const otherRate = others.length ? others.filter((r) => r.bad).length / others.length : 0;
      if (a.n >= 2 && rate >= 0.5 && rate - otherRate >= 0.2) {
        suspects.push({
          id, n: a.n, bad: a.bad, rate, otherRate,
          symptoms: Object.entries(a.sym).sort((x, y) => y[1] - x[1]).map(([s]) => s).slice(0, 5)
        });
      }
    }
    suspects.sort((x, y) => y.rate - x.rate || y.n - x.n);
    const allDone = checkins.filter((c) => c.doneAt && c.feeling != null);
    const recent = meals.slice(0, 15).map((m) => {
      const rel = doneFor(checkins, m.id);
      return {
        d: String(m.description || (m.analysis && m.analysis.food) || "").slice(0, 80),
        ings: mealKeys(m),
        comps: (m.analysis && Array.isArray(m.analysis.components) ? m.analysis.components : []).slice(0, 6),
        f: rel.length ? Math.round(rel.reduce((a, c) => a + c.feeling, 0) / rel.length * 10) / 10 : null,
        s: [...new Set(rel.flatMap((c) => c.symptoms || []))].slice(0, 5)
      };
    });
    return {
      suspects,
      avoid: suspects.map((s) => s.id),
      recent,
      baseline: allDone.length ? Math.round(allDone.reduce((a, c) => a + c.feeling, 0) / allDone.length * 10) / 10 : null,
      mealsWithData: rows.length
    };
  }

  /** Lo que viaja al proxy: solo el resumen, sin fotos ni ids. */
  function contextPayload(sig) {
    return {
      avoid: sig.avoid,
      suspects: sig.suspects.map((s) => ({ id: s.id, n: s.n, bad: s.bad, symptoms: s.symptoms })),
      recent: sig.recent,
      baseline: sig.baseline
    };
  }

  // Por franja, en orden de preferencia; `tags` = claves de taxonomía que contiene.
  // La última opción de cada franja no lleva ninguna, así siempre hay plan.
  const LIBRARY = {
    desayuno: [
      { name: "Tostadas integrales con tomate y pavo", items: ["2 tostadas de pan integral", "tomate rallado", "aceite de oliva", "pavo en lonchas", "1 plátano"], tags: ["gluten"], why: "Hidratos de absorción lenta y proteína: energía estable sin pesadez." },
      { name: "Copos de arroz con bebida de arroz y plátano", items: ["copos de arroz", "bebida de arroz", "1 plátano", "canela"], tags: [], why: "Ligero y sin lácteos ni gluten: fácil de digerir por la mañana." }
    ],
    comida: [
      { name: "Merluza al horno con patata y judías verdes", items: ["merluza", "patata asada", "judías verdes", "aceite de oliva", "limón"], tags: [], why: "Pescado blanco y verdura cocida: saciante y de digestión suave." }
    ],
    merienda: [
      { name: "Yogur natural con fresas", items: ["1 yogur natural", "fresas"], tags: ["lactosa"], why: "Tentempié ligero que aguanta hasta la cena." },
      { name: "Plátano con un puñado de nueces", items: ["1 plátano", "un puñado de nueces"], tags: ["frutosSecos"], why: "Energía rápida y grasa buena, sin pesadez." },
      { name: "Tortitas de arroz con pavo", items: ["2 tortitas de arroz", "pavo en lonchas", "rodajas de pepino"], tags: [], why: "Muy ligera y sin alérgenos frecuentes." }
    ],
    cena: [
      { name: "Tortilla francesa con ensalada", items: ["tortilla francesa de 2 huevos", "lechuga y tomate", "aceite de oliva", "1 rebanada de pan"], tags: ["huevo", "gluten"], why: "Cena rápida y ligera para dormir sin pesadez." },
      { name: "Pavo a la plancha con verduras al vapor y arroz", items: ["pechuga de pavo", "calabacín y zanahoria al vapor", "arroz blanco", "aceite de oliva"], tags: [], why: "Proteína magra y verdura cocida: digestión fácil por la noche." }
    ]
  };

  /** Plan de ejemplo sin IA (offline) que respeta las exclusiones. */
  function localPlan(scope, slot, avoid) {
    const ex = avoid || [];
    const slots = scope === "day" ? SLOTS : [SLOTS.includes(slot) ? slot : "comida"];
    const meals = slots.map((s) => {
      const opt = LIBRARY[s].find((o) => !o.tags.some((t) => ex.includes(t))) || LIBRARY[s][LIBRARY[s].length - 1];
      return { slot: s, name: opt.name, items: opt.items.slice(), why: opt.why };
    });
    const labels = ex.map((id) => (D().ONSET_WINDOWS[id] ? D().ONSET_WINDOWS[id].label.toLowerCase() : id));
    return {
      mode: ex.length ? "exclusion" : "equilibrada",
      avoid: ex.slice(),
      rationale: ex.length
        ? "Plan sin " + labels.join(", ") + ", que coinciden con tus molestias registradas; comidas sencillas y ligeras."
        : "Sin señales claras en tus registros: plan equilibrado y ligero para tener una referencia.",
      meals,
      tips: [
        "Registra cómo te sientes 2 h después de cada comida.",
        "Mantén el resto igual (horarios, agua, sueño) para comparar mejor."
      ],
      complete: true
    };
  }

  /** { slot: [claves excluidas mencionadas en el plato] } (red de seguridad local). */
  function conflicts(plan, avoid) {
    const ex = avoid || plan.avoid || [];
    const out = {};
    for (const m of plan.meals || []) {
      const hit = keysInText([m.name, ...(m.items || [])].join(" · ")).filter((k) => ex.includes(k));
      if (hit.length) out[m.slot] = hit;
    }
    return out;
  }

  function linkedTo(plan, c, meals) {
    if (c.dietId) return c.dietId === plan.id;
    const m = c.mealId && meals.find((x) => x.id === c.mealId);
    return !!(m && m.dietId === plan.id);
  }

  function stat(list) {
    const counts = {};
    for (const c of list) for (const s of c.symptoms || []) counts[s] = (counts[s] || 0) + 1;
    const withTarget = list.filter((c) => (c.symptoms || []).some((s) => TARGET_SYMPTOMS.includes(s))).length;
    return {
      n: list.length,
      avg: list.length ? list.reduce((a, c) => a + c.feeling, 0) / list.length : null,
      targetRate: list.length ? withTarget / list.length : null,
      top: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, k]) => ({ s, k }))
    };
  }

  /** Bienestar en check-ins enlazados al plan vs. check-ins sin plan. */
  function compare(plan, meals, checkins) {
    const done = checkins.filter((c) => c.doneAt && c.feeling != null);
    const anyDiet = (c) => !!c.dietId || !!(c.mealId && (meals.find((x) => x.id === c.mealId) || {}).dietId);
    return {
      with: stat(done.filter((c) => linkedTo(plan, c, meals))),
      without: stat(done.filter((c) => !anyDiet(c)))
    };
  }

  window.IntolDiet = {
    SLOTS, SLOT_LABELS, TARGET_SYMPTOMS, DISCLAIMER,
    keysInText, buildSignals, contextPayload, localPlan, conflicts, compare
  };
})();
