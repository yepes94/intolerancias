/* Intolerancias · js/diet.js
 *
 * Lógica pura de "Dieta de prueba con IA" (sin DOM, testeable en Node):
 *   - buildSignals(meals, feelings): resumen compacto para la IA + exclusiones.
 *   - localPlan(scope, slot, avoid): plan de ejemplo sin IA que respeta exclusiones.
 *   - conflicts(plan, avoid): platos que mencionan un componente excluido.
 *   - compare(plan, meals, feelings): bienestar con el plan vs. el resto.
 *   `feelings` = registros { mealId, doneAt, feeling, symptoms, dietId?, entryId? }
 *   que genera IntolDiary.feelings a partir del diario. */
(function () {
  "use strict";

  const D = () => window.IntolData;

  const SLOTS = ["desayuno", "comida", "merienda", "cena"];
  const SLOT_LABELS = { desayuno: "Desayuno", comida: "Comida", merienda: "Merienda", cena: "Cena" };

  // Síntomas que cuentan como "pesadez/malestar" para buscar señales.
  const TARGET_SYMPTOMS = ["hinchazón", "pesadez", "gases", "cansancio", "dolor abdominal", "náusea", "acidez", "diarrea"];

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
    const allDone = uniqueEntries(checkins.filter((c) => c.doneAt && c.feeling != null));
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
      { time: "08:00", name: "Tostadas integrales con tomate y pavo", items: ["2 tostadas de pan integral", "1 tomate rallado", "1 cucharada de aceite de oliva", "50 g de pavo en lonchas", "1 plátano"], tags: ["gluten"],
        steps: ["Tuesta el pan y úntalo con el tomate rallado.", "Añade un hilo de aceite y el pavo por encima.", "Toma el plátano de postre o a media mañana."],
        why: "Hidratos de absorción lenta y proteína: energía estable sin pesadez.", swap: "Pan de centeno o de espelta en lugar de integral.", watch: "Energía hasta media mañana y si aparece hinchazón tras el pan." },
      { time: "08:00", name: "Copos de arroz con bebida de arroz y plátano", items: ["40 g de copos de arroz", "200 ml de bebida de arroz", "1 plátano", "1 pizca de canela"], tags: [],
        steps: ["Templa la bebida de arroz (opcional).", "Añade los copos y deja reposar 2 minutos.", "Corta el plátano por encima y espolvorea canela."],
        why: "Ligero y sin lácteos ni gluten: fácil de digerir por la mañana.", swap: "Copos de mijo o trigo sarraceno inflado.", watch: "Si te aguanta la saciedad hasta media mañana sin pesadez." }
    ],
    comida: [
      { time: "14:00", name: "Merluza al horno con patata y judías verdes", items: ["150 g de merluza", "1 patata mediana", "150 g de judías verdes", "1 cucharada de aceite de oliva", "1/2 limón"], tags: [],
        steps: ["Hornea la patata en rodajas 20 minutos a 200 °C.", "Pon la merluza encima con aceite y limón y hornea 10–12 minutos más.", "Cuece las judías al vapor 8 minutos y sirve todo junto."],
        why: "Pescado blanco y verdura cocida: saciante y de digestión suave.", swap: "Bacalao fresco o pechuga de pollo a la plancha.", watch: "Pesadez o sueño en las 2 horas siguientes." }
    ],
    merienda: [
      { time: "17:30", name: "Yogur natural con fresas", items: ["1 yogur natural", "100 g de fresas"], tags: ["lactosa"],
        steps: ["Lava y corta las fresas.", "Mézclalas con el yogur."],
        why: "Tentempié ligero que aguanta hasta la cena.", swap: "Kéfir o yogur sin lactosa.", watch: "Gases o hinchazón en la hora siguiente." },
      { time: "17:30", name: "Plátano con un puñado de nueces", items: ["1 plátano", "20 g de nueces"], tags: ["frutosSecos"],
        steps: ["Pela el plátano.", "Acompáñalo con las nueces."],
        why: "Energía rápida y grasa buena, sin pesadez.", swap: "Pipas de calabaza en lugar de nueces.", watch: "Picor de boca u hormigueo tras los frutos secos." },
      { time: "17:30", name: "Tortitas de arroz con pavo", items: ["2 tortitas de arroz", "40 g de pavo en lonchas", "1/2 pepino"], tags: [],
        steps: ["Corta el pepino en rodajas finas.", "Monta el pavo y el pepino sobre las tortitas."],
        why: "Muy ligera y sin alérgenos frecuentes.", swap: "Tortitas de maíz y pechuga de pollo cocida.", watch: "Si llegas a la cena con hambre normal, sin ansiedad." }
    ],
    cena: [
      { time: "21:00", name: "Tortilla francesa con ensalada", items: ["2 huevos", "lechuga y tomate", "1 cucharada de aceite de oliva", "1 rebanada de pan"], tags: ["huevo", "gluten"],
        steps: ["Bate los huevos con una pizca de sal.", "Cuaja la tortilla en sartén con unas gotas de aceite.", "Aliña la ensalada con el resto del aceite."],
        why: "Cena rápida y ligera para dormir sin pesadez.", swap: "Revuelto de calabacín en lugar de tortilla.", watch: "Calidad del sueño y cómo te levantas." },
      { time: "21:00", name: "Pavo a la plancha con verduras al vapor y arroz", items: ["120 g de pechuga de pavo", "1 calabacín y 1 zanahoria", "60 g de arroz blanco (en crudo)", "1 cucharada de aceite de oliva"], tags: [],
        steps: ["Cuece el arroz 18 minutos.", "Cocina las verduras al vapor 10 minutos.", "Haz el pavo a la plancha 3–4 minutos por lado y aliña con el aceite."],
        why: "Proteína magra y verdura cocida: digestión fácil por la noche.", swap: "Merluza o pollo en lugar de pavo.", watch: "Calidad del sueño y si te levantas sin pesadez." }
    ]
  };

  /** Plan de ejemplo sin IA (offline) que respeta las exclusiones. */
  function localPlan(scope, slot, avoid) {
    const ex = avoid || [];
    const slots = scope === "day" ? SLOTS : [SLOTS.includes(slot) ? slot : "comida"];
    const meals = slots.map((s) => {
      const opt = LIBRARY[s].find((o) => !o.tags.some((t) => ex.includes(t))) || LIBRARY[s][LIBRARY[s].length - 1];
      return { slot: s, time: opt.time, name: opt.name, items: opt.items.slice(), steps: opt.steps.slice(), why: opt.why, swap: opt.swap, watch: opt.watch };
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

  // Una entrada del diario enlaza con varias comidas (un registro por comida):
  // para medias y comparación cuenta una sola vez.
  function uniqueEntries(list) {
    const seen = new Set();
    return list.filter((c) => {
      const k = c.entryId || c.id;
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Bienestar en registros enlazados al plan vs. registros sin plan
   *  (registros = Diary.feelings o check-ins antiguos, mismo formato). */
  function compare(plan, meals, checkins) {
    const done = checkins.filter((c) => c.doneAt && c.feeling != null);
    const anyDiet = (c) => !!c.dietId || !!(c.mealId && (meals.find((x) => x.id === c.mealId) || {}).dietId);
    const key = (c) => c.entryId || c.id;
    const withIds = new Set(done.filter((c) => linkedTo(plan, c, meals)).map(key));
    const dietIds = new Set(done.filter(anyDiet).map(key));
    return {
      with: stat(uniqueEntries(done.filter((c) => withIds.has(key(c))))),
      without: stat(uniqueEntries(done.filter((c) => !dietIds.has(key(c)))))
    };
  }

  const QTY = /^((?:\d+(?:[.,/]\d+)?\s*(?:–\s*\d+\s*)?(?:g|kg|ml|cl|l|cucharadas?|cucharaditas?|rebanadas?|lonchas?|tazas?|vasos?|piezas?|unidades?|pizcas?|puñados?)?\s*(?:de\s+)?)|(?:un|una|unos|unas)\s+(?:puñado|chorrito|pizca|taza|vaso|rebanada|loncha)s?\s+de\s+)/i;

  /** Ingredientes del plan agrupados por nombre: [{ name, qty: ["150 g", …] }]. */
  function shoppingList(plan) {
    const out = [];
    const byName = {};
    for (const m of (plan && plan.meals) || []) {
      for (const raw of m.items || []) {
        const it = String(raw).trim();
        if (!it) continue;
        const q = QTY.exec(it);
        const qty = q ? q[0].replace(/\s*de\s*$/i, "").trim() : "";
        const name = (q ? it.slice(q[0].length) : it).trim() || it;
        const k = name.toLowerCase();
        if (!byName[k]) { byName[k] = { name, qty: [] }; out.push(byName[k]); }
        if (qty) byName[k].qty.push(qty);
      }
    }
    for (const x of out) x.qty = sumQty(x.qty);
    return out;
  }

  /** ["1 cucharada", "1 cucharada"] → ["2 cucharadas"]; si las unidades no casan, se dejan tal cual. */
  function sumQty(qs) {
    if (qs.length < 2) return qs;
    const parts = qs.map((q) => /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(q));
    const unit = (p) => p[2].toLowerCase().replace(/s$/, "");
    if (parts.some((p) => !p || unit(p) !== unit(parts[0]))) return qs;
    const total = parts.reduce((a, p) => a + Number(p[1].replace(",", ".")), 0);
    const u = unit(parts[0]);
    const plural = total > 1 && /[aeiou]$/.test(u) ? u + "s" : u;
    return [String(Math.round(total * 100) / 100).replace(".", ",") + (u ? " " + plural : "")];
  }

  /** Texto plano del plan para copiar o compartir. */
  function planText(plan) {
    const lines = ["Dieta de prueba · Intolerancias", ""];
    if (plan.rationale) lines.push(plan.rationale, "");
    for (const m of plan.meals || []) {
      lines.push((SLOT_LABELS[m.slot] || m.slot).toUpperCase() + (m.time ? " · " + m.time : "") + " — " + m.name);
      for (const it of m.items || []) lines.push("  • " + it);
      (m.steps || []).forEach((s, i) => lines.push("  " + (i + 1) + ". " + s));
      if (m.why) lines.push("  Por qué: " + m.why);
      if (m.swap) lines.push("  Alternativa: " + m.swap);
      if (m.watch) lines.push("  Qué observar: " + m.watch);
      lines.push("");
    }
    if ((plan.tips || []).length) { lines.push("Consejos:"); for (const t of plan.tips) lines.push("  • " + t); lines.push(""); }
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  window.IntolDiet = {
    SLOTS, SLOT_LABELS, TARGET_SYMPTOMS,
    keysInText, buildSignals, contextPayload, localPlan, conflicts, compare, shoppingList, planText
  };
})();
