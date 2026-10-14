/* Intolerancias · js/features/mood-sleep.js
 *
 * Lógica pura de «Ánimo y sueño» (sin DOM, testeable en Node):
 *   - Un registro por día: { id, day: "YYYY-MM-DD", at, mood: 1-5|null, tags: [], sleep: { hours, quality }|null }.
 *     El sueño es el de la noche anterior a ese día.
 *   - upsert / remove / normalize: edición inmutable de la lista (localStorage lo hace app.js).
 *   - weekTrend(records, now): últimos 7 días, medias y cambio frente a la semana anterior.
 *   - entryContext(records, at): contexto del día de una entrada del diario (para IA y análisis local).
 *   - dietContext(records, now): resumen compacto de los últimos 7 días para /api/diet.
 *   - factors(records, entries): ¿los días con malestar coinciden con poco sueño, estrés…? */
(function () {
  "use strict";

  const DAY = 24 * 3600e3;

  const MOODS = [
    { v: 1, emoji: "😞", label: "Fatal" },
    { v: 2, emoji: "😕", label: "Bajo" },
    { v: 3, emoji: "😐", label: "Normal" },
    { v: 4, emoji: "🙂", label: "Bien" },
    { v: 5, emoji: "😄", label: "Genial" }
  ];

  // `tone`: neg = suele empeorar el día; pos = lo mejora.
  const TAGS = [
    { id: "estres", emoji: "😤", label: "Estrés", tone: "neg" },
    { id: "cansancio", emoji: "🥱", label: "Cansancio", tone: "neg" },
    { id: "ansiedad", emoji: "😰", label: "Ansiedad", tone: "neg" },
    { id: "tristeza", emoji: "😔", label: "Tristeza", tone: "neg" },
    { id: "irritable", emoji: "😠", label: "Irritable", tone: "neg" },
    { id: "energia", emoji: "⚡", label: "Energía", tone: "pos" },
    { id: "calma", emoji: "🧘", label: "Calma", tone: "pos" },
    { id: "motivacion", emoji: "💪", label: "Motivación", tone: "pos" }
  ];
  const TAG_IDS = TAGS.map((t) => t.id);
  const STRESS_TAGS = ["estres", "ansiedad"];

  const SLEEP_PRESETS = [4, 5, 6, 7, 8, 9];
  const SLEEP_QUALITY = [
    { v: 1, emoji: "😫", label: "Muy mala" },
    { v: 2, emoji: "😪", label: "Mala" },
    { v: 3, emoji: "😐", label: "Regular" },
    { v: 4, emoji: "😊", label: "Buena" },
    { v: 5, emoji: "🤩", label: "Muy buena" }
  ];
  const MAX_HOURS = 16;
  const LOW_SLEEP_H = 6;

  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  /** Mediodía local del día: evita saltos por cambio de hora al sumar/restar días. */
  function dayStart(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime() : NaN;
  }
  function shiftDay(key, delta) {
    const d = new Date(dayStart(key));
    d.setDate(d.getDate() + delta);
    return dayKey(d.getTime());
  }

  const lvl = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  /** Horas de sueño en pasos de 0,5 h (0,5–16); null si no es válido. */
  function validHours(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return null;
    return Math.min(MAX_HOURS, Math.round(n * 2) / 2);
  }
  function cleanTags(tags) {
    return [...new Set((Array.isArray(tags) ? tags : []).filter((t) => TAG_IDS.includes(t)))];
  }
  function cleanSleep(s) {
    if (!s || typeof s !== "object") return null;
    const hours = validHours(s.hours), quality = lvl(s.quality);
    return hours == null && quality == null ? null : { hours, quality };
  }
  function isEmpty(r) {
    return r.mood == null && !r.tags.length && !r.sleep;
  }

  /** Sanea lo leído de localStorage: un registro por día, orden descendente, sin vacíos. */
  function normalize(list) {
    const byDay = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object" || isNaN(dayStart(raw.day))) continue;
      const r = {
        id: String(raw.id || "ms-" + raw.day),
        day: String(raw.day),
        at: Number(raw.at) || dayStart(raw.day),
        mood: lvl(raw.mood),
        tags: cleanTags(raw.tags),
        sleep: cleanSleep(raw.sleep)
      };
      if (isEmpty(r)) continue;
      const prev = byDay.get(r.day);
      if (!prev || r.at >= prev.at) byDay.set(r.day, r);
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  function forDay(records, day) {
    return records.find((r) => r.day === day) || null;
  }

  /** Crea o actualiza el registro de `day` con `patch` ({ mood?, tags?, sleep? }).
   *  `mood: null` y `sleep: null` lo quitan; si el día queda vacío se elimina. */
  function upsert(records, day, patch, now, uid) {
    const cur = forDay(records, day);
    const base = cur || { id: (uid || ((d) => "ms-" + d))(day), day, at: now, mood: null, tags: [], sleep: null };
    const next = { ...base, at: now };
    if ("mood" in patch) next.mood = lvl(patch.mood);
    if ("tags" in patch) next.tags = cleanTags(patch.tags);
    if ("sleep" in patch) next.sleep = cleanSleep(patch.sleep);
    const rest = records.filter((r) => r.day !== day);
    return normalize(isEmpty(next) ? rest : rest.concat(next));
  }

  function remove(records, day) {
    return records.filter((r) => r.day !== day);
  }

  function toggleTag(record, tag) {
    const tags = record ? record.tags.slice() : [];
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1); else tags.push(tag);
    return tags;
  }

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

  function windowStats(records, endDay, n) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) days.push(shiftDay(endDay, -i));
    const rows = days.map((day) => {
      const r = forDay(records, day);
      return {
        day, mood: r ? r.mood : null, tags: r ? r.tags : [],
        hours: r && r.sleep ? r.sleep.hours : null, quality: r && r.sleep ? r.sleep.quality : null
      };
    });
    const tagCount = {};
    for (const row of rows) for (const t of row.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    return {
      rows,
      logged: rows.filter((r) => r.mood != null || r.hours != null || r.quality != null || r.tags.length).length,
      avgMood: round1(avg(rows.map((r) => r.mood).filter((x) => x != null))),
      avgHours: round1(avg(rows.map((r) => r.hours).filter((x) => x != null))),
      avgQuality: round1(avg(rows.map((r) => r.quality).filter((x) => x != null))),
      tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id, n]) => ({ id, n }))
    };
  }

  const diff = (a, b) => (a == null || b == null ? null : round1(a - b));

  /** Últimos 7 días (hasta hoy) + cambio frente a los 7 anteriores. */
  function weekTrend(records, now) {
    const today = dayKey(now);
    const cur = windowStats(records, today, 7);
    const prev = windowStats(records, shiftDay(today, -7), 7);
    return {
      ...cur,
      delta: { mood: diff(cur.avgMood, prev.avgMood), hours: diff(cur.avgHours, prev.avgHours), quality: diff(cur.avgQuality, prev.avgQuality) },
      prevLogged: prev.logged
    };
  }

  function flagsOf(r) {
    if (!r) return { lowSleep: false, stress: false, lowMood: false };
    return {
      lowSleep: !!(r.sleep && ((r.sleep.hours != null && r.sleep.hours < LOW_SLEEP_H) || (r.sleep.quality != null && r.sleep.quality <= 2))),
      stress: r.tags.some((t) => STRESS_TAGS.includes(t)),
      lowMood: r.mood != null && r.mood <= 2
    };
  }

  const tagLabel = (id) => (TAGS.find((t) => t.id === id) || { label: id }).label;
  const fmtH = (h) => String(h).replace(".", ",") + " h";

  /** Contexto del día de `at` para una entrada del diario; null si ese día no hay registro. */
  function entryContext(records, at) {
    const r = forDay(records, dayKey(at));
    if (!r) return null;
    const f = flagsOf(r);
    return {
      mood: r.mood, tags: r.tags.slice(),
      sleepH: r.sleep ? r.sleep.hours : null, sleepQ: r.sleep ? r.sleep.quality : null,
      lowSleep: f.lowSleep, stress: f.stress, lowMood: f.lowMood
    };
  }

  /** Frase legible del contexto («Ese día: dormiste 5 h …») o "" si no hay nada que decir. */
  function describeContext(ctx) {
    if (!ctx) return "";
    const bits = [];
    if (ctx.sleepH != null) bits.push("dormiste " + fmtH(ctx.sleepH) + (ctx.sleepQ != null ? " (calidad " + ctx.sleepQ + "/5)" : ""));
    else if (ctx.sleepQ != null) bits.push("calidad de sueño " + ctx.sleepQ + "/5");
    if (ctx.mood != null) bits.push("ánimo " + ctx.mood + "/5");
    if (ctx.tags.length) bits.push(ctx.tags.map((t) => tagLabel(t).toLowerCase()).join(", "));
    if (!bits.length) return "";
    const worse = [ctx.lowSleep && "dormir poco", ctx.stress && "el estrés", ctx.lowMood && "el ánimo bajo"].filter(Boolean);
    return "Ese día: " + bits.join(" · ") + "." +
      (worse.length ? " " + worse.join(" y ").replace(/^./, (c) => c.toUpperCase()) + " pueden agravar lo que notas, además de la comida." : "");
  }

  /** Resumen compacto de los últimos 7 días para el prompt de la dieta (sin ids ni fechas exactas). */
  function dietContext(records, now) {
    const w = weekTrend(records, now);
    if (!w.logged) return null;
    return {
      days: w.logged,
      avgMood: w.avgMood, avgSleepH: w.avgHours, avgSleepQ: w.avgQuality,
      lowSleepDays: w.rows.filter((r) => flagsOf({ sleep: r.hours != null || r.quality != null ? { hours: r.hours, quality: r.quality } : null, tags: [], mood: null }).lowSleep).length,
      stressDays: w.rows.filter((r) => r.tags.some((t) => STRESS_TAGS.includes(t))).length,
      lowMoodDays: w.rows.filter((r) => r.mood != null && r.mood <= 2).length,
      tags: w.tags.slice(0, 4).map((t) => t.id)
    };
  }

  const FACTORS = [
    { id: "pocoSueno", label: "dormir poco", test: (r) => flagsOf(r).lowSleep },
    { id: "estres", label: "estrés o ansiedad", test: (r) => flagsOf(r).stress },
    { id: "animoBajo", label: "ánimo bajo", test: (r) => flagsOf(r).lowMood }
  ];

  /** ¿Los días con malestar coinciden con poco sueño, estrés o ánimo bajo?
   *  `badDays` = Set de días con malestar. Devuelve [{ id, label, badWith, withN, rate, baseRate }]
   *  solo cuando hay datos suficientes (≥2 días con el factor y ≥2 días con malestar) y la tasa
   *  con el factor supera claramente la de los demás días. */
  function factors(records, badDays) {
    const bad = badDays instanceof Set ? badDays : new Set(badDays || []);
    const out = [];
    for (const f of FACTORS) {
      const withF = records.filter((r) => f.test(r));
      const withoutF = records.filter((r) => !f.test(r));
      if (withF.length < 2 || bad.size < 2) continue;
      const badWith = withF.filter((r) => bad.has(r.day)).length;
      const rate = badWith / withF.length;
      const baseRate = withoutF.length ? withoutF.filter((r) => bad.has(r.day)).length / withoutF.length : 0;
      if (badWith >= 2 && rate >= 0.5 && rate - baseRate >= 0.25) {
        out.push({ id: f.id, label: f.label, badWith, withN: withF.length, rate, baseRate });
      }
    }
    return out.sort((a, b) => b.rate - a.rate || b.withN - a.withN);
  }

  /** Frase corta por factor detectado, para Resumen y Dieta. */
  function factorsText(fs) {
    return fs.map((f) => "Con " + f.label + ": malestar " + f.badWith + " de " + f.withN + " días (sin ello, " +
      Math.round(f.baseRate * 100) + "%)").join(" · ") + ".";
  }

  /** Datos para los tiles de la Home: timestamps de los registros. */
  function timestamps(records) {
    return records.map((r) => dayStart(r.day));
  }

  window.IntolMoodSleep = {
    MOODS, TAGS, TAG_IDS, SLEEP_PRESETS, SLEEP_QUALITY, MAX_HOURS, LOW_SLEEP_H, DAY,
    dayKey, dayStart, shiftDay, validHours, normalize, forDay, upsert, remove, toggleTag,
    weekTrend, flagsOf, entryContext, describeContext, dietContext, factors, factorsText,
    tagLabel, fmtH, timestamps
  };
})();
