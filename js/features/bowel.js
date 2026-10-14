/* Intolerancias · js/features/bowel.js
 *
 * Lógica pura del registro de deposiciones (escala de Bristol, sin DOM, testeable en Node):
 *   - TYPES / CATS: los 7 tipos con emoji, nombre, explicación corta y categoría.
 *   - make(input): normaliza un registro { id, at, createdAt, type, note, pain, urgency, blood }.
 *   - redFlag(s) / flagsOf(s): marcas rápidas y aviso de consulta (sangre).
 *   - symptomsOf(s): síntomas de IntolData.SYMPTOMS que implica (diarrea, estreñimiento, dolor abdominal).
 *   - windowStools / payload: deposiciones de las 24 h anteriores para /api/diary.
 *   - feelingRecords: registros anómalos enlazados a las comidas previas (señal para Resumen y Dieta).
 *   - contextPayload: resumen para /api/diet.
 *   - distribution: reparto por tipos para el Resumen. */
(function () {
  "use strict";

  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const WINDOW_H = 24;
  const MAX_NOTE = 280;

  const CATS = {
    constipation: { label: "Estreñimiento", tone: "warn" },
    normal: { label: "Normal", tone: "good" },
    soft: { label: "Tendencia a blanda", tone: "mid" },
    diarrhea: { label: "Diarrea", tone: "warn" }
  };

  const TYPES = [
    { type: 1, emoji: "🌰", name: "Bolitas duras y separadas", short: "Duras, como nueces", cat: "constipation",
      desc: "Trozos duros y separados, difíciles de expulsar: estreñimiento marcado." },
    { type: 2, emoji: "🥜", name: "Salchicha grumosa", short: "Con grumos", cat: "constipation",
      desc: "Forma de salchicha pero llena de bultos: estreñimiento leve." },
    { type: 3, emoji: "🌭", name: "Salchicha con grietas", short: "Con grietas", cat: "normal",
      desc: "Forma de salchicha con grietas en la superficie: normal." },
    { type: 4, emoji: "🍌", name: "Salchicha lisa", short: "Lisa y blanda", cat: "normal",
      desc: "Salchicha lisa y blanda: la más habitual en una digestión sana." },
    { type: 5, emoji: "☁️", name: "Trozos blandos", short: "Blandos, bordes nítidos", cat: "soft",
      desc: "Trozos blandos de bordes definidos: puede faltar fibra o tender a blanda." },
    { type: 6, emoji: "🫧", name: "Pastosa y esponjosa", short: "Pastosa", cat: "diarrhea",
      desc: "Trozos esponjosos de bordes irregulares: diarrea leve." },
    { type: 7, emoji: "💧", name: "Líquida", short: "Líquida, sin trozos", cat: "diarrhea",
      desc: "Totalmente líquida, sin partes sólidas: diarrea." }
  ];

  const FLAGS = [
    { id: "pain", emoji: "⚡", label: "Dolor" },
    { id: "urgency", emoji: "🏃", label: "Urgencia" },
    { id: "blood", emoji: "🩸", label: "Sangre" }
  ];

  const BLOOD_ADVICE = "Has marcado sangre: consulta con un profesional sanitario, sobre todo si se repite, es abundante o va con dolor, mareo o fiebre.";

  const clipNote = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  const validType = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
  };
  const typeInfo = (t) => TYPES[validType(t) - 1] || null;
  const catOf = (t) => (typeInfo(t) ? CATS[typeInfo(t).cat] : null);

  /** Registro normalizado; null si el tipo no es 1–7. */
  function make(input) {
    const i = input || {};
    const type = validType(i.type);
    if (type == null) return null;
    const at = Number(i.at);
    const now = Date.now();
    return {
      id: String(i.id || "bw-" + now.toString(36) + Math.random().toString(36).slice(2, 7)),
      at: isFinite(at) && at > 0 ? Math.min(at, now + 60e3) : now,
      createdAt: Number(i.createdAt) || now,
      type,
      note: clipNote(i.note),
      pain: i.pain === true,
      urgency: i.urgency === true,
      blood: i.blood === true
    };
  }

  /** Lo guardado en localStorage, saneado (descarta basura). */
  function sanitizeList(list) {
    return (Array.isArray(list) ? list : []).map((s) => make(s)).filter(Boolean)
      .sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
  }

  const flagsOf = (s) => FLAGS.filter((f) => s && s[f.id] === true);
  const redFlag = (s) => !!(s && s.blood === true);
  const isAbnormal = (s) => !!s && (CATS[typeInfo(s.type).cat].tone === "warn" || s.pain === true || s.blood === true);

  /** Síntomas de IntolData.SYMPTOMS que implica el registro (para el cruce con comidas). */
  function symptomsOf(s) {
    const out = [];
    if (!s) return out;
    if (s.type >= 6) out.push("diarrea");
    if (s.type <= 2) out.push("estreñimiento");
    if (s.pain) out.push("dolor abdominal");
    return out;
  }

  /** Deposiciones de las `hours` horas anteriores a `at` (la más reciente primero). */
  function windowStools(stools, at, hours) {
    const h = (hours || WINDOW_H) * HOUR;
    return (stools || []).filter((s) => s.at <= at && at - s.at <= h).sort((a, b) => b.at - a.at);
  }

  /** Para /api/diary: [{ h, type, pain, urgency, blood }] sin notas ni ids. */
  function payload(stools, at) {
    return windowStools(stools, at).slice(0, 8).map((s) => ({
      h: Math.round((at - s.at) / HOUR * 10) / 10,
      type: s.type,
      pain: s.pain === true,
      urgency: s.urgency === true,
      blood: s.blood === true
    }));
  }

  /** Línea legible de las deposiciones recientes para el análisis local. */
  function describeWindow(stools, at) {
    const w = windowStools(stools, at);
    if (!w.length) return "";
    const types = [...new Set(w.map((s) => s.type))].sort();
    const abn = w.filter(isAbnormal);
    return w.length + " deposición(es) en las 24 h anteriores (Bristol " + types.join(", ") + ")" +
      (abn.length ? ", " + abn.length + " fuera de lo normal" : "") + ".";
  }

  /** Registros { mealId, doneAt, feeling, symptoms, entryId, bowel:true } de las deposiciones
   *  anómalas, enlazados a las comidas de las 24 h anteriores (misma forma que Diary.feelings). */
  function feelingRecords(stools, meals) {
    const out = [];
    for (const s of stools || []) {
      if (!isAbnormal(s)) continue;
      const symptoms = symptomsOf(s);
      if (!symptoms.length) continue;
      const base = { entryId: "bw-" + s.id, doneAt: s.at, feeling: 2, symptoms, bowel: true };
      const ms = (meals || []).filter((m) => m.createdAt <= s.at && s.at - m.createdAt <= DAY);
      if (!ms.length) out.push({ ...base, mealId: null });
      for (const m of ms) out.push({ ...base, mealId: m.id });
    }
    return out;
  }

  /** Reparto por tipo en los últimos `days` días. → { total, counts[7], days, abnormal, byCat } */
  function distribution(stools, now, days) {
    const d = days || 30;
    const from = (now || Date.now()) - d * DAY;
    const list = (stools || []).filter((s) => s.at >= from && s.at <= (now || Date.now()) + 60e3);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const byCat = { constipation: 0, normal: 0, soft: 0, diarrhea: 0 };
    for (const s of list) { counts[s.type - 1]++; byCat[typeInfo(s.type).cat]++; }
    return {
      total: list.length, counts, byCat, days: d,
      blood: list.filter((s) => s.blood).length,
      pain: list.filter((s) => s.pain).length,
      urgency: list.filter((s) => s.urgency).length,
      top: list.length ? counts.indexOf(Math.max(...counts)) + 1 : null
    };
  }

  /** Para /api/diet: resumen de 14 días sin notas ni fechas exactas. */
  function contextPayload(stools, now) {
    const dist = distribution(stools, now, 14);
    if (!dist.total) return null;
    return {
      days: 14, total: dist.total, counts: dist.counts,
      pain: dist.pain, urgency: dist.urgency, blood: dist.blood
    };
  }

  window.IntolBowel = {
    WINDOW_H, TYPES, CATS, FLAGS, BLOOD_ADVICE,
    make, sanitizeList, validType, typeInfo, catOf, flagsOf, redFlag, isAbnormal, symptomsOf,
    windowStools, payload, describeWindow, feelingRecords, distribution, contextPayload
  };
})();
