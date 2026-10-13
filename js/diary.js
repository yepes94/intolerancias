/* Intolerancias · js/diary.js
 *
 * Lógica pura del diario libre de síntomas (sin DOM, testeable en Node):
 *   - extractSymptoms(text) / redFlags(text): lo que cuenta el usuario.
 *   - windowMeals / linkedMeals: qué comidas cruzar con cada entrada (24 h antes).
 *   - payload(entry, meals): lo que viaja a /api/diary (sin fotos ni ids).
 *   - localAnalyze(entry, meals, suspects): causas posibles sin IA, por coincidencias.
 *   - feelings(meals, entries): registros { mealId, doneAt, feeling, symptoms } para
 *     Resumen y Dieta (mismo formato que usaban los check-ins).
 *   - mergeLegacy(entries, checkins): check-ins respondidos → entradas «históricas».
 *   - reminderState(...): si toca el recordatorio de las 21:00.
 * Orientativo, no médico. */
(function () {
  "use strict";

  const D = () => window.IntolData;
  const Diet = () => window.IntolDiet;

  const WINDOW_H = 24;
  const MAX_MEALS = 12;
  const HOUR = 3600e3;

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const clip = (s, n) => {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
  };

  // Texto libre (sin tildes) → síntoma de IntolData.SYMPTOMS.
  const SYMPTOM_WORDS = [
    [/hinchad|hinchazon|inflad|barriga dura|distension/, "hinchazón"],
    [/pesad|empach|indigest/, "pesadez"],
    [/gases|flatulen|ventosi|eructo|eructa/, "gases"],
    [/dolor (de |en (la |el )?)?(barriga|tripa|estomago|abdomen|vientre)|dolor abdominal|retortij|colico|duele (la |el )?(barriga|tripa|estomago|vientre)/, "dolor abdominal"],
    [/diarrea|descompuest|heces liquidas/, "diarrea"],
    [/nausea|ganas de vomitar|vomit|mareo|maread/, "náusea"],
    [/acidez|ardor|reflujo|quemazon/, "acidez"],
    [/cansad|cansancio|agotad|sin energia|fatiga|somnolen|amodorrad/, "cansancio"],
    [/dolor de cabeza|cefalea|migrana|jaqueca|duele la cabeza/, "dolor de cabeza"],
    [/erupcion|ronchas|urticaria|picor|me pica|sarpullido|eccema|granitos/, "erupción"],
    [/estren/, "estreñimiento"]
  ];

  // Señales de alarma: se avisa de buscar atención médica (no se diagnostica).
  const RED_FLAGS = /sangre|sangrado|no puedo respirar|dificultad (para|al) respirar|me ahogo|ahogo|garganta (cerrada|hinchada)|(labios|lengua|cara|garganta) hinchad|hinchazon de (labios|lengua|cara|garganta)|desmay|perdi el conocimiento|fiebre alta|dolor (muy )?(fuerte|intenso|insoportable)/;

  // Síntoma → componentes que suelen asociarse (orientativo, para el análisis local).
  const SYMPTOM_HINTS = {
    "hinchazón": ["lactosa", "fructosa", "gluten", "soja"],
    "gases": ["lactosa", "fructosa", "gluten", "soja"],
    "diarrea": ["lactosa", "fructosa", "picante", "alcohol", "cafeina"],
    "dolor abdominal": ["lactosa", "gluten", "fructosa", "picante"],
    "pesadez": ["picante", "gluten"],
    "acidez": ["picante", "cafeina", "alcohol"],
    "náusea": ["picante", "alcohol", "huevo"],
    "dolor de cabeza": ["histamina", "alcohol", "cafeina"],
    "erupción": ["histamina", "frutosSecos", "huevo", "soja"],
    "cansancio": ["gluten", "histamina", "alcohol"],
    "estreñimiento": ["gluten"]
  };

  const LIKELIHOOD = ["alta", "media", "baja"];

  function extractSymptoms(text) {
    const t = norm(text);
    const out = [];
    for (const [re, s] of SYMPTOM_WORDS) if (re.test(t) && !out.includes(s)) out.push(s);
    return out;
  }

  function redFlags(text) {
    return RED_FLAGS.test(norm(text));
  }

  function validLevel(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  }

  /** Nivel 1–5 para estadísticas: el del usuario o uno implícito por lo que cuenta. */
  function entryScore(e) {
    const lv = validLevel(e && e.level);
    if (lv != null) return lv;
    return (e && ((e.symptoms || []).length || redFlags(e.text))) ? 2 : 3;
  }

  function isBadEntry(e) {
    return entryScore(e) <= 2.5 || (e.symptoms || []).some((s) => Diet().TARGET_SYMPTOMS.includes(s));
  }

  /** Sin molestias aparentes: no hace falta buscar causas (se puede forzar). */
  function looksFine(e) {
    const lv = validLevel(e.level);
    return lv != null && lv >= 4 && !(e.symptoms || []).length && !redFlags(e.text);
  }

  function mealKeys(m) {
    const ids = new Set((m.ingredients || []).map((i) => i.id).filter((id) => D().ONSET_WINDOWS[id]));
    const a = m.analysis || {};
    for (const c of Array.isArray(a.components) ? a.components : []) for (const id of Diet().keysInText(c)) ids.add(id);
    if (a.food) for (const id of Diet().keysInText(a.food)) ids.add(id);
    return [...ids];
  }

  /** Comidas de las `hours` horas anteriores a `at`, la más cercana primero. */
  function windowMeals(meals, at, hours) {
    const h = (hours || WINDOW_H) * HOUR;
    return meals.filter((m) => m.createdAt <= at && at - m.createdAt <= h)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function causeIds(e) {
    const c = e && e.analysis && Array.isArray(e.analysis.causes) ? e.analysis.causes : [];
    return [...new Set(c.map((x) => x && x.mealId).filter(Boolean))];
  }

  /** Comidas a las que se atribuye la entrada: la enlazada (histórico), las citadas
   *  como causa si la entrada es de malestar, o las de la ventana de 24 h. */
  function linkedMeals(e, meals) {
    if (e.mealId) {
      const m = meals.find((x) => x.id === e.mealId);
      return m ? [m] : [];
    }
    const cited = causeIds(e);
    if (cited.length && isBadEntry(e)) {
      const ms = meals.filter((m) => cited.includes(m.id));
      if (ms.length) return ms;
    }
    return windowMeals(meals, e.at);
  }

  /** Registros por (entrada, comida) con el formato que esperan Resumen y Dieta. */
  function feelings(meals, entries) {
    const out = [];
    for (const e of entries) {
      const base = {
        entryId: e.id, doneAt: e.at, feeling: entryScore(e), symptoms: (e.symptoms || []).slice(),
        ...(e.dietId ? { dietId: e.dietId } : {})
      };
      const ms = linkedMeals(e, meals);
      if (!ms.length) out.push({ ...base, mealId: null });
      for (const m of ms) out.push({ ...base, mealId: m.id });
    }
    return out;
  }

  function entriesForMeal(meal, meals, entries) {
    return entries.filter((e) => linkedMeals(e, meals).some((m) => m.id === meal.id))
      .sort((a, b) => a.at - b.at);
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function fmtAgo(hours) {
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + " min";
    const h = Math.floor(hours), m = Math.round((hours - h) * 60);
    return h + " h" + (m ? " " + m + " min" : "");
  }

  /** Lo que viaja al proxy: texto, hora, nivel y comidas resumidas. Sin fotos ni ids. */
  function payload(e, meals, suspects) {
    const ms = windowMeals(meals, e.at).slice(0, MAX_MEALS);
    const refs = {};
    const list = ms.map((m, i) => {
      const ref = "m" + (i + 1);
      refs[ref] = m.id;
      const a = m.analysis || {};
      return {
        ref,
        h: Math.round((e.at - m.createdAt) / HOUR * 10) / 10,
        time: hhmm(m.createdAt),
        d: clip(m.description, 140),
        food: clip(a.food, 120),
        comps: (Array.isArray(a.components) ? a.components : []).slice(0, 6).map((x) => clip(x, 60)),
        ings: mealKeys(m),
        summary: clip(a.summary, 300)
      };
    });
    return {
      body: {
        entry: { text: clip(e.text, 1500), time: hhmm(e.at), level: validLevel(e.level), symptoms: (e.symptoms || []).slice(0, 8) },
        meals: list,
        suspects: (suspects || []).slice(0, 6)
      },
      refs
    };
  }

  /** Resultado del proxy ({ causes: [{ ref }] }) → causas con mealId real. */
  function applyRefs(result, refs) {
    const causes = (result.causes || []).map((c) => ({
      mealId: refs[c.ref] || null,
      components: (c.components || []).slice(0, 6),
      ingredients: (c.ingredients || []).filter((k) => D().ONSET_WINDOWS[k]),
      likelihood: LIKELIHOOD.includes(c.likelihood) ? c.likelihood : "baja",
      reason: String(c.reason || "")
    })).filter((c) => c.mealId);
    return { summary: String(result.summary || ""), causes, advice: String(result.advice || ""), urgent: !!result.urgent };
  }

  /** Causas posibles sin IA: componentes de cada comida × ventana típica × síntomas. */
  function localAnalyze(e, meals, suspects) {
    const syms = e.symptoms || [];
    const hinted = new Set(syms.flatMap((s) => SYMPTOM_HINTS[s] || []));
    const known = new Set(suspects || []);
    const W = D().ONSET_WINDOWS;
    const ms = windowMeals(meals, e.at).slice(0, MAX_MEALS);
    const causes = [];
    for (const m of ms) {
      const h = (e.at - m.createdAt) / HOUR;
      const hits = [];
      for (const k of mealKeys(m)) {
        const w = W[k];
        const inWin = h >= w.startH && h <= w.endH;
        const near = !inWin && h >= w.startH * 0.5 && h <= w.endH * 1.5 + 1;
        const score = (inWin ? 2 : near ? 1 : 0) + (hinted.has(k) ? 1 : 0) + (known.has(k) ? 1 : 0);
        if (score >= 2 && (inWin || near)) hits.push({ k, score, inWin, sym: hinted.has(k), known: known.has(k) });
      }
      if (!hits.length) continue;
      hits.sort((a, b) => b.score - a.score);
      const best = hits[0].score;
      const labels = hits.map((x) => W[x.k].label);
      const why = hits.slice(0, 2).map((x) => {
        const w = W[x.k];
        return w.label + " suele notarse entre " + fmtAgo(w.startH) + " y " + fmtAgo(w.endH) +
          (x.inWin ? "" : " (por los pelos)") + (x.sym ? " y encaja con " + syms.filter((s) => (SYMPTOM_HINTS[s] || []).includes(x.k)).join(", ") : "") +
          (x.known ? "; ya coincidió con molestias otras veces" : "");
      });
      causes.push({
        mealId: m.id, score: best,
        components: labels, ingredients: hits.map((x) => x.k),
        likelihood: best >= 4 ? "alta" : best === 3 ? "media" : "baja",
        reason: "Comiste esto hace " + fmtAgo(h) + ". " + why.join(". ") + "."
      });
    }
    causes.sort((a, b) => b.score - a.score || 0);
    const top = causes.slice(0, 3).map(({ score, ...c }) => c);
    let summary;
    if (!ms.length) {
      summary = "No hay comidas registradas en las 24 h anteriores: registra lo que comes para poder cruzarlo con cómo te sientes.";
    } else if (!top.length) {
      summary = "Ninguna de las " + ms.length + " comida(s) de las últimas 24 h encaja claramente por horario con componentes típicos" +
        (syms.length ? " de " + syms.join(", ") : "") + ". Puede deberse a otra cosa (sueño, estrés, cantidad).";
    } else {
      const m0 = meals.find((m) => m.id === top[0].mealId);
      summary = "Lo que más encaja: " + top[0].components.join(", ").toLowerCase() + " de «" +
        clip(m0.description || (m0.analysis && m0.analysis.food) || "comida", 60) + "»" +
        (top.length > 1 ? " (y " + (top.length - 1) + " comida(s) más)" : "") + ".";
    }
    return {
      summary,
      causes: top,
      advice: top.length
        ? "Si se repite con lo mismo, prueba unos días sin ese componente y apunta cómo te sientes."
        : "Sigue anotando comidas y cómo te sientes: con más registros se ven mejor las coincidencias.",
      urgent: redFlags(e.text)
    };
  }

  /** Check-ins respondidos → entradas del diario marcadas como históricas (idempotente). */
  function mergeLegacy(entries, checkins) {
    const out = entries.slice();
    const have = new Set(out.map((e) => e.id));
    for (const c of checkins || []) {
      if (!c || !c.doneAt) continue;
      const id = "ck-" + c.id;
      if (have.has(id)) continue;
      have.add(id);
      out.push({
        id, at: c.doneAt, createdAt: c.doneAt,
        text: String(c.note || ""),
        level: validLevel(c.feeling),
        symptoms: Array.isArray(c.symptoms) ? c.symptoms.slice() : [],
        mealId: c.mealId || null,
        ...(c.dietId ? { dietId: c.dietId } : {}),
        legacy: { prompt: String(c.prompt || "Check-in"), scheduledAt: c.scheduledAt || null },
        analysis: null
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function parseHour(hm) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hm || ""));
    return m ? { h: Number(m[1]), m: Number(m[2]) } : { h: 21, m: 0 };
  }

  function atHour(ts, hm) {
    const { h, m } = parseHour(hm);
    const d = new Date(ts);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  function nextReminderAt(now, hm) {
    const t = atHour(now, hm);
    if (t > now) return t;
    const d = new Date(t);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  /** ¿Toca recordar? Hoy desde la hora indicada, o ayer si se quedó sin contar.
   *  → { due, day, when: "hoy"|"ayer", meals } */
  function reminderState(meals, entries, now, hm, dismissed) {
    const has = (k) => entries.some((e) => dayKey(e.at) === k || dayKey(e.createdAt || e.at) === k);
    const count = (k) => meals.filter((m) => dayKey(m.createdAt) === k).length;
    const today = dayKey(now);
    if (now >= atHour(now, hm) && count(today) && !has(today) && dismissed !== today) {
      return { due: true, day: today, when: "hoy", meals: count(today) };
    }
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yk = dayKey(y.getTime());
    if (count(yk) && !has(yk) && dismissed !== yk && !has(today)) {
      return { due: true, day: yk, when: "ayer", meals: count(yk) };
    }
    return { due: false, day: today, when: "hoy", meals: count(today) };
  }

  window.IntolDiary = {
    WINDOW_H, LIKELIHOOD, SYMPTOM_HINTS,
    extractSymptoms, redFlags, entryScore, isBadEntry, looksFine, mealKeys,
    windowMeals, linkedMeals, feelings, entriesForMeal, payload, applyRefs, localAnalyze,
    mergeLegacy, dayKey, atHour, nextReminderAt, reminderState, fmtAgo
  };
})();
