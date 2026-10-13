/* Intolerancias · js/app.js — UI + diario de síntomas + recordatorio + resumen local. */
(function () {
  "use strict";

  const S = window.IntolStore;
  const P = window.IntolProviders;
  const D = window.IntolData;
  const Diet = window.IntolDiet;
  const Diary = window.IntolDiary;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- estado ----------
  let meals = S.getMeals();
  let diary = S.getDiary();
  let diets = S.getDiets();
  let settings = S.getSettings();
  // Los check-ins respondidos del sistema anterior pasan al diario como históricos
  // (una sola vez; la clave antigua no se borra).
  if (!S.diaryMigrated()) {
    diary = Diary.mergeLegacy(diary, S.getCheckins());
    S.saveDiary(diary);
    S.setDiaryMigrated();
  }
  let draftPhoto = null;      // dataURL comprimida (full) pendiente de guardar
  let draftThumb = null;
  let activeMealFeeling = 3;
  let diaryLevel = null;
  let diaryDietId = null;
  let diaryAtFixed = null;    // hora propuesta (p. ej. ayer 21:00) o editada; null = «ahora» al guardar
  const analyzing = new Set();
  const FACES = ["", "😖", "🙁", "😐", "🙂", "😄"];

  // ---------- util ----------
  function toast(msg, ms) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add("hidden"), ms || 2600);
  }
  function fmtDT(ts) {
    return new Date(ts).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function persist() { S.saveMeals(meals); S.saveDiary(diary); }
  function mealById(id) { return meals.find((m) => m.id === id); }
  function feels() { return Diary.feelings(meals, diary); }
  function showTab(name) {
    const b = document.querySelector('[data-tab="' + name + '"]');
    if (b) b.click();
  }

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => {
        x.classList.remove("active"); x.removeAttribute("aria-current");
      });
      b.classList.add("active"); b.setAttribute("aria-current", "page");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $("tab-" + b.dataset.tab).classList.add("active");
      if (!document.body.classList.contains("scroll-locked")) window.scrollTo({ top: 0, behavior: "instant" });
      if (b.dataset.tab === "timeline") renderTimeline();
      if (b.dataset.tab === "resumen") renderSummary();
      if (b.dataset.tab === "dieta") renderDiet();
      if (b.dataset.tab === "ajustes") renderProviderStatus();
    });
  });

  // ---------- sentimiento (botones 1-5) ----------
  function wireFeeling(elId, get, set) {
    $(elId).querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        set(Number(b.dataset.v));
        $(elId).querySelectorAll("button").forEach((x) => {
          const on = Number(x.dataset.v) === get();
          x.classList.toggle("sel", on);
          x.setAttribute("aria-pressed", String(on));
        });
      });
    });
  }
  wireFeeling("mealFeeling", () => activeMealFeeling, (v) => { activeMealFeeling = v; });

  // ---------- foto ----------
  $("mealPhoto").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      draftPhoto = await S.compressImage(f, 1024, 0.72);
      draftThumb = await S.compressImage(f, 320, 0.65);
      $("photoPreview").src = draftThumb;
      $("photoPreviewWrap").classList.remove("hidden");
    } catch (err) { toast("No se pudo procesar la foto: " + err.message); }
  });
  $("photoClear").addEventListener("click", () => {
    draftPhoto = draftThumb = null;
    $("mealPhoto").value = "";
    $("photoPreviewWrap").classList.add("hidden");
  });

  // ---------- guardar comida ----------
  $("saveMealBtn").addEventListener("click", async () => {
    const desc = $("mealDesc").value.trim();
    if (!desc && !draftPhoto) { toast("Describe qué comiste o sube una foto"); return; }
    const local = P.localAnalyze(desc);
    // Ingredientes del último análisis IA (si coincide con esta descripción).
    let iaIds = [];
    try { iaIds = JSON.parse($("analysisResult").dataset.ingredients || "[]"); }
    catch { iaIds = []; }
    // Respuesta completa de la IA: se guarda APARTE, sin pisar la descripción.
    let analysis = null;
    try {
      const raw = JSON.parse($("analysisResult").dataset.analysis || "null");
      if (raw && typeof raw.summary === "string" && raw.summary) {
        analysis = {
          provider: String(raw.provider || ""), label: String(raw.label || "IA"),
          at: Number(raw.at) || Date.now(),
          food: String(raw.food || "").slice(0, 120),
          components: Array.isArray(raw.components)
            ? raw.components.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 6) : [],
          summary: String(raw.summary).slice(0, 2000),
          checkinQuestion: String(raw.checkinQuestion || "").slice(0, 280)
        };
      }
    } catch { analysis = null; }
    $("analysisResult").dataset.ingredients = "";
    $("analysisResult").dataset.analysis = "";
    const meal = {
      id: S.uid(),
      createdAt: Date.now(),
      description: desc,
      feeling0: activeMealFeeling,
      ingredients: local.ingredients.map((id) => ({ id, source: "local" })),
      thumb: draftThumb || null,
      analysis
    };
    for (const id of iaIds) {
      if (D.ONSET_WINDOWS[id] && !meal.ingredients.some((i) => i.id === id)) {
        meal.ingredients.push({ id, source: "ia" });
      }
    }
    if (draftPhoto) {
      try { await S.photoPut(meal.id, draftPhoto); meal.hasPhoto = true; }
      catch { meal.thumb = draftPhoto; meal.hasPhoto = false; }
    }
    meals.unshift(meal);
    persist();
    $("mealDesc").value = "";
    $("photoClear").click();
    toast("Comida guardada · si te sienta mal, cuéntalo en el diario");
    renderTimeline();
    checkReminder();
  });

  // ---------- analizar con IA ----------
  $("analyzeBtn").addEventListener("click", async () => {
    const desc = $("mealDesc").value.trim();
    const box = $("analysisResult");
    const prov = P.active(settings);
    if (!prov) {
      const local = P.localAnalyze(desc);
      box.classList.remove("hidden");
      box.innerHTML = "<strong>Análisis local (sin clave IA):</strong> " + esc(local.summary) +
        "<br><span class='hint'>Configura tu clave en Ajustes para usar Claude con visión.</span>";
      return;
    }
    if (!prov.implemented) {
      toast(prov.label + " aún no implementado · usando análisis local");
      const local = P.localAnalyze(desc);
      box.classList.remove("hidden");
      box.innerHTML = "<strong>Análisis local:</strong> " + esc(local.summary);
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = "⏳ Analizando con " + esc(prov.label) + "…";
    try {
      const out = await prov.analyzeFood(
        { description: desc, imageDataUrl: draftPhoto },
        settings.keys[prov.id], settings.model, settings);
      box.innerHTML = "<strong>🤖 " + esc(prov.label) + ":</strong> " + esc(out.summary) +
        (out.food ? "<br><strong>Detectado:</strong> " + esc(out.food) +
          (out.components && out.components.length ? " (" + esc(out.components.join(", ")) + ")" : "") : "");
      // Fusiona ingredientes detectados por IA en la próxima comida guardada
      box.dataset.ingredients = JSON.stringify(out.ingredients || []);
      // Guarda la respuesta completa para persistirla con la comida (no se pierde).
      box.dataset.analysis = JSON.stringify({
        provider: prov.id, label: prov.label, at: Date.now(),
        food: out.food || "", components: out.components || [],
        summary: out.summary || "", checkinQuestion: out.checkinQuestion || ""
      });
    } catch (err) {
      const info = P.describeError(err, prov.label);
      const local = P.localAnalyze(desc);
      box.innerHTML = "⚠️ " + esc(info.title) +
        "<br><span class='hint'>" + esc(info.hint) + "</span>" +
        "<br><br><strong>Análisis local (sin IA, sigue funcionando):</strong> " + esc(local.summary);
      // El fallback local también deja sus ingredientes listos para guardar.
      box.dataset.ingredients = JSON.stringify(local.ingredients || []);
      box.dataset.analysis = "";
    }
  });

  // ---------- notificaciones + service worker ----------
  const canNotify = () => "Notification" in window;
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* sin SW: queda `new Notification` */ });
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data && ev.data.type === "open-diary") openDiary(diaryOptsForDay(ev.data.day));
    });
  }

  $("enableNotifBtn").addEventListener("click", async () => {
    if (!canNotify()) { toast("Este navegador no permite notificaciones aquí"); renderNotifStatus(); return; }
    const perm = await Notification.requestPermission();
    toast(perm === "granted" ? "Notificaciones activadas" : "Permiso: " + perm);
    renderNotifStatus();
  });

  async function notify(title, body, tag, day) {
    if (!canNotify() || Notification.permission !== "granted") return false;
    const opts = { body, tag, data: { day } };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return true; }
    } catch { /* sigue con la API clásica */ }
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); openDiary(diaryOptsForDay(day)); n.close(); };
      return true;
    } catch { return false; }
  }

  $("testReminderBtn").addEventListener("click", async () => {
    const sent = await notify("Intolerancias · ¿cómo te sientes?",
      "Así se verá el recordatorio del diario.", "diario-prueba", "");
    toast(sent ? "Aviso de prueba enviado" : "Sin permiso de notificaciones: el recordatorio se verá dentro de la app");
  });

  function renderNotifStatus() {
    const el = $("notifStatus");
    const t = settings.reminder.time;
    const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    if (!canNotify()) {
      el.textContent = (/iPhone|iPad/.test(navigator.userAgent) && !standalone
        ? "En iPhone las notificaciones web solo existen con la app añadida a la pantalla de inicio. "
        : "Este navegador no permite notificaciones aquí. ") + "Verás el recordatorio dentro de la app.";
    } else if (Notification.permission === "granted") {
      el.textContent = "✔ Notificaciones activadas. " + (settings.reminder.enabled
        ? "Aviso a las " + t + " si ese día hay comidas y el diario está vacío."
        : "El recordatorio está desactivado.");
    } else if (Notification.permission === "denied") {
      el.textContent = "Notificaciones bloqueadas: actívalas en los ajustes del sitio del navegador. Verás el recordatorio dentro de la app.";
    } else {
      el.textContent = "Pulsa «Activar notificaciones» para recibir el aviso de las " + t + ".";
    }
  }

  // ---------- recordatorio diario (21:00 por defecto) ----------
  let reminderTimer = null;
  function diaryOptsForDay(day) {
    if (!day || day === Diary.dayKey(Date.now())) return {};
    const t = new Date(day + "T" + settings.reminder.time).getTime();
    return isFinite(t) ? { at: t } : {};
  }

  function checkReminder() {
    clearTimeout(reminderTimer);
    const banner = $("reminderBanner");
    if (!settings.reminder.enabled) { banner.classList.add("hidden"); return; }
    const now = Date.now();
    const r = S.getReminder();
    const st = Diary.reminderState(meals, diary, now, settings.reminder.time, r.dismissed);
    if (st.due) {
      $("reminderText").textContent = st.when === "hoy"
        ? "Hoy has registrado " + st.meals + " comida(s) y aún no has contado cómo te sientes. ¿Qué tal te han sentado?"
        : "Ayer registraste " + st.meals + " comida(s) pero no contaste cómo te sentiste. ¿Lo apuntas ahora?";
      banner.dataset.day = st.day;
      banner.classList.remove("hidden");
      if (st.when === "hoy" && r.notified !== st.day) {
        r.notified = st.day;
        S.saveReminder(r);
        // Si la app está a la vista y el aviso llega tarde (se abrió después de la hora), basta el banner.
        const late = now - Diary.atHour(now, settings.reminder.time) > 10 * 60e3;
        if (document.visibilityState !== "visible" || !late) {
          notify("Intolerancias · ¿cómo te sientes?",
            "Hoy has registrado " + st.meals + " comida(s). Cuéntale al diario qué tal te han sentado.",
            "diario-" + st.day, st.day);
        }
      }
    } else {
      banner.classList.add("hidden");
    }
    const next = Diary.nextReminderAt(now, settings.reminder.time);
    reminderTimer = setTimeout(checkReminder, Math.min(next - now + 1000, 2147483000));
  }
  setInterval(checkReminder, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkReminder(); });

  $("reminderWrite").addEventListener("click", () => openDiary(diaryOptsForDay($("reminderBanner").dataset.day)));
  $("reminderDismiss").addEventListener("click", () => {
    const r = S.getReminder();
    r.dismissed = $("reminderBanner").dataset.day;
    S.saveReminder(r);
    checkReminder();
  });

  function readReminderSettings() {
    settings.reminder = {
      enabled: $("reminderEnabled").checked,
      time: /^\d\d:\d\d$/.test($("reminderTime").value) ? $("reminderTime").value : "21:00"
    };
    S.saveSettings(settings);
    renderNotifStatus();
    checkReminder();
  }
  $("reminderEnabled").addEventListener("change", readReminderSettings);
  $("reminderTime").addEventListener("change", readReminderSettings);

  // ---------- diario de síntomas ----------
  function toLocalInput(ts) {
    const d = new Date(ts);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function fromLocalInput(v) {
    const t = new Date(v).getTime();
    return isFinite(t) ? t : Date.now();
  }

  function setLevelButtons() {
    $("diaryLevel").querySelectorAll("button").forEach((x) => {
      const on = Number(x.dataset.v) === diaryLevel;
      x.classList.toggle("sel", on);
      x.setAttribute("aria-pressed", String(on));
    });
  }
  $("diaryLevel").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const v = Number(b.dataset.v);
      diaryLevel = diaryLevel === v ? null : v;
      setLevelButtons();
    });
  });

  function updateDiaryCtx() {
    const n = Diary.windowMeals(meals, diaryAtFixed || Date.now()).length;
    const diet = diaryDietId && diets.find((d) => d.id === diaryDietId);
    $("diaryCtx").textContent = (diet ? "Siguiendo: " + dietTitle(diet) + ". " : "") + (n
      ? "Se cruzará con " + n + " comida(s) de las 24 h anteriores."
      : "No hay comidas en las 24 h anteriores a esa hora: se guardará igualmente.");
    const text = $("diaryText").value;
    const sy = Diary.extractSymptoms(text);
    $("diaryDetected").textContent = (sy.length ? "Detectado: " + sy.join(", ") + "." : "") +
      (Diary.redFlags(text) ? " ⚠️ Si es intenso o empeora, busca atención médica (112)." : "");
  }
  $("diaryText").addEventListener("input", updateDiaryCtx);
  $("diaryAt").addEventListener("change", () => {
    diaryAtFixed = fromLocalInput($("diaryAt").value);
    updateDiaryCtx();
  });

  function openDiary(opts) {
    const o = opts || {};
    diaryDietId = o.dietId || null;
    diaryLevel = null;
    diaryAtFixed = o.at || null;
    $("diaryText").value = "";
    $("diaryAt").value = toLocalInput(o.at || Date.now());
    $("diaryAt").max = toLocalInput(Date.now() + 60e3);
    setLevelButtons();
    updateDiaryCtx();
    if (!$("diaryModal").open) {
      lockScroll();
      $("diaryModal").showModal();
      $("diaryModal").querySelector(".modal-body").scrollTop = 0;
      $("diaryText").focus({ preventScroll: true });
    }
  }

  // iOS Safari ignora overflow:hidden en <html>; fijar <body> es lo único que evita el scroll del fondo.
  let lockedScrollY = 0;
  function lockScroll() {
    lockedScrollY = window.scrollY;
    document.body.style.top = -lockedScrollY + "px";
    document.body.classList.add("scroll-locked");
  }
  function unlockScroll() {
    if (!document.body.classList.contains("scroll-locked")) return;
    document.body.classList.remove("scroll-locked");
    document.body.style.top = "";
    window.scrollTo({ top: lockedScrollY, behavior: "instant" });
  }
  $("diaryModal").addEventListener("close", unlockScroll);

  $("diaryFab").addEventListener("click", () => openDiary());
  $("diaryOpenBtn").addEventListener("click", () => openDiary());
  $("diaryClose").addEventListener("click", () => $("diaryModal").close());
  $("diarySave").addEventListener("click", () => {
    const text = $("diaryText").value.trim();
    if (!text) { toast("Cuenta cómo te sientes"); $("diaryText").focus(); return; }
    const e = {
      id: S.uid(),
      at: Math.min(diaryAtFixed || Date.now(), Date.now()),
      createdAt: Date.now(),
      text: text.slice(0, 1500),
      level: diaryLevel,
      symptoms: Diary.extractSymptoms(text),
      analysis: null,
      ...(diaryDietId ? { dietId: diaryDietId } : {})
    };
    diary.push(e);
    diary.sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
    persist();
    $("diaryModal").close();
    showTab("timeline");
    if (Diary.looksFine(e)) {
      toast("Apuntado ✔ · ¡que siga así!");
      afterDiaryChange();
      return;
    }
    toast((e.level && e.level <= 2) || e.symptoms.length ? "Apuntado · buscando posibles causas…" : "Apuntado ✔");
    analyzeEntry(e);
  });

  function afterDiaryChange() {
    renderTimeline(); renderDiaryRecent(); renderSummary(); renderDiet(); checkReminder();
  }

  async function analyzeEntry(e) {
    const others = diary.filter((x) => x.id !== e.id);
    const suspects = Diet.buildSignals(meals, Diary.feelings(meals, others)).avoid;
    const local = () => ({ source: "local", label: "Análisis local", at: Date.now(), ...Diary.localAnalyze(e, meals, suspects) });
    const prov = P.active(settings);
    const withMeals = Diary.windowMeals(meals, e.at).length > 0;
    if (!prov || !prov.implemented || !prov.analyzeDiary || !withMeals) {
      e.analysis = local();
      persist(); afterDiaryChange();
      return;
    }
    analyzing.add(e.id);
    renderTimeline();
    const { body, refs } = Diary.payload(e, meals, suspects);
    let analysis;
    try {
      const res = await prov.analyzeDiary(body, settings.keys[prov.id], settings.model, settings);
      analysis = { source: "ia", provider: prov.id, label: prov.label, at: Date.now(), ...Diary.applyRefs(res, refs) };
      if (Diary.redFlags(e.text)) analysis.urgent = true;
    } catch (err) {
      const info = P.describeError(err, prov.label);
      analysis = { ...local(), error: info.title };
    } finally {
      analyzing.delete(e.id);
    }
    const cur = diary.find((x) => x.id === e.id);
    if (cur) { cur.analysis = analysis; persist(); }
    afterDiaryChange();
  }

  function renderDiaryRecent() {
    const ul = $("diaryRecent");
    const list = diary.slice(0, 3);
    if (!list.length) {
      ul.innerHTML = "<li class='empty'>Aún no has escrito nada. Cuando te sientas mal, pulsa «¿Cómo te sientes?».</li>";
      return;
    }
    ul.innerHTML = "";
    for (const e of list) {
      const li = document.createElement("li");
      const a = e.analysis;
      const first = a && a.causes && a.causes[0] && mealById(a.causes[0].mealId);
      li.innerHTML = "<button type='button' class='diary-recent-item'><time>" + esc(fmtDT(e.at)) + "</time>" +
        "<span>" + esc((e.text || (e.legacy && e.legacy.prompt) || "").slice(0, 90)) + "</span>" +
        (first ? "<span class='hint'>Posible causa: " + esc((first.description || "comida").slice(0, 50)) + "</span>" : "") +
        "</button>";
      li.querySelector("button").addEventListener("click", () => {
        showTab("timeline");
        const el = document.getElementById("entry-" + e.id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      ul.appendChild(li);
    }
  }

  function diaryAnalysisHtml(e) {
    if (analyzing.has(e.id)) {
      const prov = P.active(settings);
      return "<div class='diary-analysis is-pending'>⏳ Buscando posibles causas" + (prov ? " con " + esc(prov.label) : "") + "…</div>";
    }
    const a = e.analysis;
    if (!a) {
      return Diary.looksFine(e) ? "<p class='hint'>Sin molestias: no hace falta buscar causas.</p>" : "";
    }
    const causes = (a.causes || []).map((c) => {
      const m = mealById(c.mealId);
      const ago = m ? Diary.fmtAgo((e.at - m.createdAt) / 3600e3) : "";
      return "<li><span class='pill lk-" + esc(c.likelihood) + "'>" + esc(c.likelihood) + "</span> " +
        "<strong>" + esc(m ? (m.description || (m.analysis && m.analysis.food) || "(solo foto)") : "(comida borrada)") + "</strong>" +
        (m ? " <span class='hint'>" + esc(fmtDT(m.createdAt)) + " · " + esc(ago) + " antes</span>" : "") +
        ((c.components || []).length ? "<br>" + esc(c.components.join(", ")) : "") +
        (c.reason ? "<br><span class='hint'>" + esc(c.reason) + "</span>" : "") + "</li>";
    }).join("");
    return "<div class='diary-analysis" + (a.source === "ia" ? " is-ia" : "") + "'>" +
      (a.urgent ? "<p class='diary-urgent'>🚑 Lo que describes puede necesitar atención médica. Si es intenso o empeora, llama al 112 o acude a urgencias.</p>" : "") +
      "<p><strong>" + (a.source === "ia" ? "🤖 " + esc(a.label || "IA") : "🔎 Análisis local (sin IA)") + " · posibles causas</strong></p>" +
      "<p>" + esc(a.summary || "") + "</p>" +
      (causes ? "<ol class='diary-causes'>" + causes + "</ol>" : "") +
      (a.advice ? "<p>💡 " + esc(a.advice) + "</p>" : "") +
      (a.error ? "<p class='hint'>⚠️ La IA no respondió: " + esc(a.error) + " Se muestra el análisis local.</p>" : "") +
      "</div>";
  }

  function diaryCard(e) {
    const card = document.createElement("article");
    card.className = "meal diary-entry" + (Diary.isBadEntry(e) ? " is-bad" : "");
    card.id = "entry-" + e.id;
    const lm = e.legacy && e.mealId && mealById(e.mealId);
    card.innerHTML =
      "<header class='meal-head'><span class='diary-icon' aria-hidden='true'>📝</span>" +
      "<div class='meal-title'><strong>" + (e.legacy ? "Check-in (histórico)" : "Diario") + "</strong>" +
      "<time datetime='" + new Date(e.at).toISOString() + "'>" + fmtDT(e.at) + "</time></div>" +
      (e.level ? "<span class='diary-level'>" + FACES[e.level] + " <span class='score'>" + e.level + "/5</span></span>" : "") +
      "</header>" +
      (e.text ? "<p class='diary-text'>" + esc(e.text) + "</p>" : "") +
      (e.legacy ? "<p class='hint'>" + esc(e.legacy.prompt) + (lm ? " · sobre «" + esc(lm.description || "comida") + "»" : "") + "</p>" : "") +
      ((e.symptoms || []).length || e.dietId ? "<div class='pills'>" +
        (e.symptoms || []).map((x) => "<span class='pill src-sym'>" + esc(x) + "</span>").join("") +
        (e.dietId ? "<span class='pill src-diet'>🥗 Dieta de prueba</span>" : "") + "</div>" : "") +
      diaryAnalysisHtml(e);
    const row = document.createElement("div");
    row.className = "row";
    const b1 = document.createElement("button");
    b1.className = "btn small ghost";
    b1.textContent = e.analysis ? "🔄 Reanalizar" : "🔎 Buscar causas";
    b1.disabled = analyzing.has(e.id);
    b1.addEventListener("click", () => analyzeEntry(e));
    const b2 = document.createElement("button");
    b2.className = "btn small ghost"; b2.textContent = "Borrar";
    b2.addEventListener("click", () => {
      if (!confirm("¿Borrar esta entrada del diario?")) return;
      diary = diary.filter((x) => x.id !== e.id);
      persist(); afterDiaryChange();
    });
    row.append(b1, b2);
    card.appendChild(row);
    return card;
  }

  // ---------- timeline ----------
  async function renderTimeline() {
    const wrap = $("timeline");
    if (!meals.length && !diary.length) {
      wrap.innerHTML = "<p class='empty'>Aún no hay comidas ni entradas del diario. Registra la primera en la pestaña ＋ Registrar.</p>";
      return;
    }
    wrap.innerHTML = "";
    const items = meals.map((m) => ({ t: m.createdAt, m })).concat(diary.map((e) => ({ t: e.at, e })))
      .sort((a, b) => b.t - a.t).slice(0, 80);
    for (const it of items) {
      if (it.e) { wrap.appendChild(diaryCard(it.e)); continue; }
      const m = it.m;
      const card = document.createElement("article");
      card.className = "meal";
      const ings = m.ingredients.map((i) => {
        const w = D.ONSET_WINDOWS[i.id];
        return "<span class='pill src-" + esc(i.source) + "' title='" + esc(w ? w.hint : "") + "'>" +
          esc(w ? w.label : i.id) + "</span>";
      }).join("");
      const follows = Diary.entriesForMeal(m, meals, diary);
      const face = FACES[m.feeling0] || "😐";
      card.innerHTML =
        "<header class='meal-head'>" +
        (m.thumb ? "<img class='meal-thumb' alt='Foto de la comida' src='" + m.thumb + "' data-full='" + m.id + "' loading='lazy' />" : "") +
        "<div class='meal-title'><strong>" + esc(m.description || "(solo foto)") + "</strong>" +
        (m.dietId ? "<span class='pill src-diet'>🥗 Dieta de prueba</span>" : "") +
        "<time datetime='" + new Date(m.createdAt).toISOString() + "'>" + fmtDT(m.createdAt) + "</time></div></header>" +
        "<p class='meal-feeling'>Al comer: " + face + " <span class='score'>" + m.feeling0 + "/5</span></p>" +
        (ings ? "<div class='pills'>" + ings + "</div>" : "") +
        (m.analysis ? analysisHtml(m.analysis) : "") +
        "<div class='follow'>" +
        (follows.length
          ? "<ul class='follow-list'>" + follows.map((e) => {
            const cited = e.analysis && (e.analysis.causes || []).some((c) => c.mealId === m.id);
            return "<li>📝 <time>" + fmtDT(e.at) + "</time> → <strong class='score'>" + Diary.entryScore(e) + "/5</strong> " +
              esc((e.symptoms || []).join(", ")) + (e.text ? " · “" + esc(e.text.slice(0, 80)) + "”" : "") +
              (cited ? " <span class='pill lk-media'>posible causa</span>" : "") + "</li>";
          }).join("") + "</ul>"
          : "<span class='hint'>Sin entradas del diario en las 24 h siguientes.</span>") +
        "</div>";
      const row = document.createElement("div");
      row.className = "row";
      const b1 = document.createElement("button");
      b1.className = "btn small ghost"; b1.textContent = "📝 Diario";
      b1.addEventListener("click", () => openDiary());
      const b2 = document.createElement("button");
      b2.className = "btn small ghost"; b2.textContent = "Borrar";
      b2.addEventListener("click", async () => {
        if (!confirm("¿Borrar esta comida? (tus entradas del diario se mantienen)")) return;
        meals = meals.filter((x) => x.id !== m.id);
        await S.photoDel(m.id);
        persist(); renderTimeline(); renderSummary(); checkReminder();
      });
      row.append(b1, b2);
      if (m.analysis) {
        const b3 = document.createElement("button");
        b3.className = "btn small ghost"; b3.textContent = "✏️ Análisis";
        b3.addEventListener("click", () => openAnalysisEditor(card, m));
        const b4 = document.createElement("button");
        b4.className = "btn small ghost"; b4.textContent = "Quitar IA";
        b4.addEventListener("click", () => {
          if (!confirm("¿Quitar el análisis IA guardado? (tu descripción no se toca)")) return;
          m.analysis = null;
          persist(); renderTimeline();
        });
        row.append(b3, b4);
      }
      card.appendChild(row);
      wrap.appendChild(card);
      const img = card.querySelector("img[data-full]");
      if (img && m.hasPhoto) {
        img.style.cursor = "zoom-in";
        img.title = "Tocar para ver a tamaño completo";
        img.addEventListener("click", async () => {
          const full = await S.photoGet(m.id);
          if (full) window.open(full, "_blank");
        });
      }
    }
  }

  // ---------- análisis IA persistido (no pisa la descripción) ----------
  function analysisHtml(a) {
    const head = (a.food ? "<strong>" + esc(a.food) + "</strong>" : "Análisis IA") +
      ((a.components && a.components.length) ? " <span class='hint'>(" + esc(a.components.join(", ")) + ")</span>" : "");
    return "<div class='ai-analysis'><p>🤖 " + esc(a.label || "IA") + ": " + head +
      "<br>" + esc(a.summary || "") + "</p></div>";
  }

  function openAnalysisEditor(card, meal) {
    const box = card.querySelector(".ai-analysis");
    const a = meal.analysis;
    box.innerHTML =
      "<label class='field'><span>Alimento detectado</span>" +
      "<input type='text' data-f='food' value='" + esc(a.food || "") + "' maxlength='120' /></label>" +
      "<label class='field'><span>Componentes <small>(separados por comas)</small></span>" +
      "<input type='text' data-f='components' value='" + esc((a.components || []).join(", ")) + "' /></label>" +
      "<label class='field'><span>Resumen</span>" +
      "<textarea data-f='summary' rows='2' maxlength='2000'>" + esc(a.summary || "") + "</textarea></label>" +
      "<div class='row'><button class='btn small primary' data-act='save'>Guardar</button>" +
      "<button class='btn small ghost' data-act='cancel'>Cancelar</button></div>";
    box.querySelector("[data-act='save']").addEventListener("click", () => {
      meal.analysis = {
        ...a,
        food: box.querySelector("[data-f='food']").value.trim().slice(0, 120),
        components: box.querySelector("[data-f='components']").value.split(",")
          .map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 6),
        summary: box.querySelector("[data-f='summary']").value.trim().slice(0, 2000)
      };
      persist(); renderTimeline(); toast("Análisis actualizado");
    });
    box.querySelector("[data-act='cancel']").addEventListener("click", renderTimeline);
  }

  // ---------- resumen ----------
  function stats() {
    // ingId -> {n, sum, bad}
    const acc = {};
    const recs = feels();
    for (const m of meals) {
      const rel = recs.filter((c) => c.mealId === m.id);
      if (!rel.length) continue;
      const avg = rel.reduce((a, c) => a + c.feeling, 0) / rel.length;
      for (const ing of m.ingredients) {
        acc[ing.id] = acc[ing.id] || { n: 0, sum: 0, bad: 0 };
        acc[ing.id].n++; acc[ing.id].sum += avg;
        if (avg <= 2.5) acc[ing.id].bad++;
      }
    }
    return Object.entries(acc).map(([id, v]) => ({ id, avg: v.sum / v.n, n: v.n, bad: v.bad }));
  }

  function renderSummary() {
    const rows = stats();
    const good = rows.filter((r) => r.avg >= 3.8).sort((a, b) => b.avg - a.avg);
    const bad = rows.filter((r) => r.avg <= 2.6).sort((a, b) => a.avg - b.avg);
    const mid = rows.filter((r) => r.avg > 2.6 && r.avg < 3.8);
    const li = (r) => {
      const w = D.ONSET_WINDOWS[r.id];
      return "<li><strong>" + esc(w ? w.label : r.id) + "</strong> · media " + r.avg.toFixed(1) +
        "/5 en " + r.n + " comida(s)" + (r.bad ? " · " + r.bad + " con malestar" : "") + "</li>";
    };
    $("goodList").innerHTML = good.length ? good.map(li).join("") : "<li class='empty'>Sin datos aún</li>";
    $("midList").innerHTML = mid.length ? mid.map(li).join("") : "<li class='empty'>Sin datos aún</li>";
    $("badList").innerHTML = bad.length ? bad.map(li).join("") : "<li class='empty'>Sin datos aún</li>";

    const sug = $("suggestions");
    sug.innerHTML = "";
    const cands = rows.filter((r) => r.n >= 2 && r.bad / r.n >= 0.6);
    if (!cands.length) {
      sug.innerHTML = "<p class='hint'>Aún no hay suficientes datos para sugerir descartes " +
        "(hacen falta ≥2 comidas con un ingrediente y malestar en ≥60%). Sigue registrando 🙂</p>";
    }
    for (const r of cands.sort((a, b) => (b.bad / b.n) - (a.bad / a.n))) {
      const w = D.ONSET_WINDOWS[r.id];
      const div = document.createElement("div");
      div.className = "suggestion";
      div.innerHTML = "🧪 <strong>Prueba a no comer " + esc(w ? w.label.toLowerCase() : r.id) + "</strong> " +
        "durante unos días y observa (" + r.bad + "/" + r.n + " veces con malestar).<br>" +
        "<span class='hint'>Ejemplos: " + esc(w ? w.hint : "") + ".</span>";
      sug.appendChild(div);
    }
  }

  $("exportBtn").addEventListener("click", () => {
    const legacy = S.getCheckins();
    const data = { meals, diary, diets, ...(legacy.length ? { checkinsLegacy: legacy } : {}), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "intolerancias-datos.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("wipeBtn").addEventListener("click", () => {
    if (!confirm("¿Borrar TODOS los datos locales (comidas, diario, planes, fotos)?")) return;
    S.wipe(); meals = []; diary = []; diets = [];
    persist(); S.setDiaryMigrated(); afterDiaryChange();
    toast("Datos locales borrados");
  });

  // ---------- ajustes / BYOK ----------
  function renderProviderStatus() {
    const box = $("providerStatus");
    const rows = P.order.map((id) => {
      const p = P.registry[id];
      const hasKey = !!(settings.keys && settings.keys[id]);
      const dot = p.implemented ? (hasKey ? "🟢" : "⚪") : "🔧";
      return "<li>" + dot + " <strong>" + esc(p.label) + "</strong> — " +
        (p.implemented ? (hasKey ? "clave guardada" : "sin clave") : "pendiente de implementar") + "</li>";
    }).join("");
    const act = P.active(settings);
    box.innerHTML = "<ul class='plain'>" + rows + "</ul>" +
      "<p class='hint'>Activo: <strong>" + esc(act ? act.label : "ninguno (análisis local)") + "</strong> · " +
      "prioridad Claude &gt; Hermes &gt; Groq &gt; Cursor</p>";
    $("key-claude").value = settings.keys.claude || "";
    $("key-hermes").value = settings.keys.hermes || "";
    $("key-groq").value = settings.keys.groq || "";
    $("key-cursor").value = settings.keys.cursor || "";
    $("claudeModel").value = settings.model || D.DEFAULT_MODEL;
    $("groqModel").value = settings.groqModel || D.GROQ_MODEL;
  }

  $("saveKeysBtn").addEventListener("click", () => {
    settings.keys = {
      claude: $("key-claude").value.trim(),
      hermes: $("key-hermes").value.trim(),
      groq: $("key-groq").value.trim(),
      cursor: $("key-cursor").value.trim()
    };
    Object.keys(settings.keys).forEach((k) => { if (!settings.keys[k]) delete settings.keys[k]; });
    settings.model = $("claudeModel").value.trim() || D.DEFAULT_MODEL;
    settings.groqModel = $("groqModel").value.trim() || D.GROQ_MODEL;
    S.saveSettings(settings);
    renderProviderStatus();
    $("providerMsg").textContent = "Claves guardadas solo en este navegador. Nunca se commitean.";
    toast("Ajustes guardados");
  });

  $("testIaBtn").addEventListener("click", async () => {
    const prov = P.active(settings);
    if (!prov) { $("providerMsg").textContent = "Sin claves: funcionará el análisis local."; return; }
    $("providerMsg").textContent = "Probando " + prov.label + "…";
    try {
      await prov.ping(settings.keys[prov.id], settings.model);
      $("providerMsg").textContent = "✔ " + prov.label + " responde correctamente.";
    } catch (err) {
      const info = P.describeError(err, prov.label);
      $("providerMsg").textContent = "⚠️ " + info.title + " " + info.hint;
    }
  });


  // ---------- dieta de prueba ----------
  function dietScope() {
    const el = document.querySelector("input[name='dietScope']:checked");
    return el ? el.value : "day";
  }
  function dietTitle(d) {
    return d.scope === "day" ? "Día completo" : Diet.SLOT_LABELS[d.slot] || "Una comida";
  }
  function ingLabel(id) {
    const w = D.ONSET_WINDOWS[id];
    return w ? w.label : id;
  }

  document.querySelectorAll("input[name='dietScope']").forEach((r) => {
    r.addEventListener("change", () => $("dietSlotField").classList.toggle("hidden", dietScope() !== "meal"));
  });

  function renderDietSignals() {
    const sig = Diet.buildSignals(meals, feels());
    const box = $("dietSignals");
    if (!sig.mealsWithData) {
      box.innerHTML = "<p class='hint'>Aún no hay comidas con entradas del diario: se propondrá una " +
        "<strong>dieta equilibrada y ligera</strong>. Cuantos más registros, más afinado el plan.</p>";
    } else if (!sig.suspects.length) {
      box.innerHTML = "<p class='hint'>Sin señales claras en " + sig.mealsWithData + " comida(s) con entradas del diario: " +
        "se propondrá una <strong>dieta equilibrada y ligera</strong>.</p>";
    } else {
      box.innerHTML = "<p><strong>Se excluirá:</strong></p><ul class='plain'>" + sig.suspects.map((x) =>
        "<li><span class='pill src-avoid'>" + esc(ingLabel(x.id)) + "</span> " + x.bad + "/" + x.n +
        " comidas con malestar" + (x.symptoms.length ? " (" + esc(x.symptoms.join(", ")) + ")" : "") + "</li>"
      ).join("") + "</ul><p class='hint'>Coinciden con hinchazón, pesadez, gases o cansancio más que el resto. " +
        "El plan priorizará comidas con energía y poca pesadez.</p>";
    }
    return sig;
  }

  function savePlan(plan, scope, slot, source, label, sig) {
    const d = {
      id: S.uid(), createdAt: Date.now(), scope, slot: scope === "meal" ? slot : "",
      source, label,
      mode: plan.mode, avoid: plan.avoid || [],
      rationale: plan.rationale || "", tips: plan.tips || [],
      meals: plan.meals, signals: sig.suspects.map((x) => ({ id: x.id, n: x.n, bad: x.bad, symptoms: x.symptoms })),
      eaten: {}
    };
    diets.unshift(d);
    S.saveDiets(diets);
    renderDiet(d.id);
    return d;
  }

  $("dietLocalBtn").addEventListener("click", () => {
    const sig = renderDietSignals();
    const scope = dietScope(), slot = $("dietSlot").value;
    savePlan(Diet.localPlan(scope, slot, sig.avoid), scope, slot, "local", "Plan local (sin IA)", sig);
    $("dietStatus").classList.add("hidden");
    toast("Plan local guardado");
  });

  $("dietAskBtn").addEventListener("click", async () => {
    const sig = renderDietSignals();
    const scope = dietScope(), slot = $("dietSlot").value;
    const box = $("dietStatus");
    const prov = P.active(settings);
    box.classList.remove("hidden");
    if (!prov || !prov.implemented || !prov.planDiet) {
      savePlan(Diet.localPlan(scope, slot, sig.avoid), scope, slot, "local", "Plan local (sin IA)", sig);
      box.innerHTML = (prov ? esc(prov.label) + " aún no implementado" : "Sin clave IA") +
        ": se ha generado un <strong>plan local</strong> con las mismas exclusiones. " +
        "<span class='hint'>Configura Claude o Groq en Ajustes para un plan con IA.</span>";
      return;
    }
    const btn = $("dietAskBtn");
    btn.disabled = true;
    box.innerHTML = "⏳ Pidiendo dieta a " + esc(prov.label) + "…";
    try {
      const plan = await prov.planDiet({ scope, slot, context: Diet.contextPayload(sig) },
        settings.keys[prov.id], settings.model, settings);
      savePlan(plan, scope, slot, prov.id, prov.label, sig);
      box.classList.add("hidden");
      toast("Plan guardado");
    } catch (err) {
      const info = P.describeError(err, prov.label);
      const action = err && err.kind === "auth"
        ? "Acción: abre Ajustes, borra la clave y pégala de nuevo completa."
        : "Acción: pulsa de nuevo «Pedir dieta».";
      box.innerHTML = "⚠️ " + esc(info.title) +
        "<br><span class='hint'>" + action + " Mientras tanto, «Plan local sin IA» respeta las mismas exclusiones.</span>";
    } finally {
      btn.disabled = false;
    }
  });

  function eatPlanMeal(d, pm) {
    const desc = Diet.SLOT_LABELS[pm.slot] + " (dieta de prueba): " + pm.name +
      (pm.items && pm.items.length ? " — " + pm.items.join(", ") : "");
    const meal = {
      id: S.uid(), createdAt: Date.now(), description: desc, feeling0: 3,
      ingredients: Diet.keysInText(desc).map((id) => ({ id, source: "local" })),
      thumb: null, analysis: null, dietId: d.id, dietSlot: pm.slot
    };
    meals.unshift(meal);
    d.eaten = d.eaten || {};
    d.eaten[pm.slot] = meal.createdAt;
    persist(); S.saveDiets(diets);
    renderTimeline(); renderDiet(d.id); checkReminder();
    toast("Registrado · si notas algo, cuéntalo en el diario");
  }

  function fmtAvg(st) {
    return st.n ? st.avg.toFixed(1) + "/5 <span class='hint'>(" + st.n + ")</span>" : "<span class='hint'>sin datos</span>";
  }
  function fmtRate(st) {
    return st.n ? Math.round(st.targetRate * 100) + "%" : "–";
  }

  function compareHtml(d) {
    const c = Diet.compare(d, meals, feels());
    const top = (st) => st.top.length ? st.top.map((t) => esc(t.s) + " ×" + t.k).join(", ") : "–";
    const col = (title, st, cls) => "<div class='diet-compare-col " + cls + "'><p class='diet-slot'>" + title + "</p><dl>" +
      "<dt>Nivel medio</dt><dd>" + fmtAvg(st) + "</dd>" +
      "<dt>Con pesadez, hinchazón o cansancio</dt><dd>" + fmtRate(st) + "</dd>" +
      "<dt>Síntomas</dt><dd>" + top(st) + "</dd></dl></div>";
    return "<div class='diet-compare'><p><strong>¿Cómo te sienta?</strong></p><div class='diet-compare-grid'>" +
      col("Con el plan", c.with, "is-plan") + col("Sin plan", c.without, "is-base") + "</div>" +
      (c.with.n ? "" : "<p class='hint'>Sigue el plan con «Comí esto» y cuenta en el diario cómo te sientes para comparar.</p>") +
      "</div>";
  }

  async function sharePlan(d) {
    const text = Diet.planText(d);
    try {
      if (navigator.share) { await navigator.share({ title: "Dieta de prueba", text }); return; }
      await navigator.clipboard.writeText(text);
      toast("Plan copiado al portapapeles");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      toast("No se pudo copiar el plan");
    }
  }

  function dietCard(d, open) {
    const det = document.createElement("details");
    det.className = "diet-plan";
    det.open = !!open;
    const conf = Diet.conflicts(d, d.avoid);
    const done = Object.keys(d.eaten || {}).length;
    const shop = Diet.shoppingList(d);
    det.innerHTML =
      "<summary><span class='diet-plan-title'><strong>🥗 " + esc(dietTitle(d)) + "</strong>" +
      "<time datetime='" + new Date(d.createdAt).toISOString() + "'>" + fmtDT(d.createdAt) + "</time></span>" +
      "<span class='pill " + (d.mode === "exclusion" ? "src-avoid" : "src-local") + "'>" +
      (d.mode === "exclusion" ? "Sin " + esc(d.avoid.map(ingLabel).join(", ").toLowerCase()) : "Equilibrada y ligera") + "</span>" +
      "<span class='hint'>" + esc(d.label) + (done ? " · " + done + "/" + d.meals.length + " hechas" : "") + "</span></summary>" +
      "<div class='diet-plan-body'>" +
      (d.rationale ? "<p class='diet-rationale'>" + esc(d.rationale) + "</p>" : "") +
      (d.meals.length > 1 ? "<div class='diet-glance'><p class='diet-slot'>Tu día de un vistazo</p><ol>" + d.meals.map((pm) =>
        "<li><button type='button' class='diet-glance-item' data-goto='" + esc(pm.slot) + "'>" +
        "<span class='diet-time'>" + esc(pm.time || "–") + "</span>" +
        "<span><span class='diet-glance-slot'>" + esc(Diet.SLOT_LABELS[pm.slot] || pm.slot) + "</span>" + esc(pm.name) + "</span>" +
        (d.eaten && d.eaten[pm.slot] ? "<span class='diet-glance-done' aria-label='registrada'>✔</span>" : "") +
        "</button></li>").join("") + "</ol></div>" : "") +
      "<ol class='diet-meals'>" + d.meals.map((pm) =>
        "<li data-slot='" + esc(pm.slot) + "'><p class='diet-slot'>" + esc(Diet.SLOT_LABELS[pm.slot] || pm.slot) +
        (pm.time ? " <span class='diet-time'>" + esc(pm.time) + "</span>" : "") + "</p>" +
        "<p class='diet-dish'><strong>" + esc(pm.name) + "</strong></p>" +
        (pm.items && pm.items.length ? "<p class='diet-label'>Ingredientes</p><ul class='diet-items'>" + pm.items.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
        (pm.steps && pm.steps.length ? "<details class='diet-steps'><summary>Cómo prepararlo (" + pm.steps.length + " pasos)</summary><ol>" +
          pm.steps.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol></details>" : "") +
        (pm.why || pm.swap || pm.watch ? "<dl class='diet-notes'>" +
          (pm.why ? "<div><dt>💡 Por qué</dt><dd>" + esc(pm.why) + "</dd></div>" : "") +
          (pm.swap ? "<div><dt>🔁 Alternativa</dt><dd>" + esc(pm.swap) + "</dd></div>" : "") +
          (pm.watch ? "<div class='is-watch'><dt>👀 Qué observar después</dt><dd>" + esc(pm.watch) + "</dd></div>" : "") +
          "</dl>" : "") +
        (conf[pm.slot] ? "<p class='diet-warn'>⚠️ Revisa: puede contener " + esc(conf[pm.slot].map(ingLabel).join(", ").toLowerCase()) +
          ", que querías evitar. Cámbialo por una alternativa sin ese componente.</p>" : "") +
        "<div class='row'>" + (d.eaten && d.eaten[pm.slot]
          ? "<span class='hint'>✔ Registrado " + esc(fmtDT(d.eaten[pm.slot])) + "</span>"
          : "<button class='btn small' data-eat='" + esc(pm.slot) + "'>Comí esto</button>") + "</div></li>"
      ).join("") + "</ol>" +
      (d.tips && d.tips.length ? "<div class='diet-tips'><p class='diet-label'>Consejos</p><ul>" + d.tips.map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul></div>" : "") +
      (shop.length ? "<details class='diet-shop'><summary>🛒 Lista de la compra (" + shop.length + ")</summary><ul>" +
        shop.map((x) => "<li><span>" + esc(x.name) + "</span>" + (x.qty.length ? "<span class='hint'>" + esc(x.qty.join(" + ")) + "</span>" : "") + "</li>").join("") +
        "</ul></details>" : "") +
      compareHtml(d) +
      "<div class='row'><button class='btn small primary' data-act='feel'>Registrar cómo me siento</button>" +
      "<button class='btn small' data-act='share'>Compartir plan</button>" +
      "<button class='btn small ghost' data-act='del'>Borrar plan</button></div>" +
      "</div>";
    det.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
      const li = det.querySelector(".diet-meals > li[data-slot='" + b.dataset.goto + "']");
      if (li) li.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    det.querySelector("[data-act='share']").addEventListener("click", () => sharePlan(d));
    det.querySelectorAll("[data-eat]").forEach((b) => {
      const pm = d.meals.find((x) => x.slot === b.dataset.eat);
      b.addEventListener("click", () => eatPlanMeal(d, pm));
    });
    det.querySelector("[data-act='feel']").addEventListener("click", () => openDiary({ dietId: d.id }));
    det.querySelector("[data-act='del']").addEventListener("click", () => {
      if (!confirm("¿Borrar este plan? (las comidas y entradas del diario que registraste se mantienen)")) return;
      diets = diets.filter((x) => x.id !== d.id);
      S.saveDiets(diets);
      renderDiet();
    });
    return det;
  }

  function renderDiet(openId) {
    renderDietSignals();
    const wrap = $("dietList");
    if (!diets.length) {
      wrap.innerHTML = "<p class='empty'>Aún no hay planes. Pide uno arriba: se guardan en este navegador.</p>";
      return;
    }
    const keep = openId || (wrap.querySelector("details[open]") || {}).dataset?.id || diets[0].id;
    wrap.innerHTML = "";
    for (const d of diets.slice(0, 30)) {
      const card = dietCard(d, d.id === keep);
      card.dataset.id = d.id;
      wrap.appendChild(card);
    }
  }

  // ---------- init ----------
  $("reminderEnabled").checked = settings.reminder.enabled;
  $("reminderTime").value = settings.reminder.time;
  renderTimeline();
  renderDiaryRecent();
  renderProviderStatus();
  renderNotifStatus();
  renderDiet();
  checkReminder();
  const qs = new URLSearchParams(location.search);
  if (qs.has("diario")) {
    history.replaceState(null, "", location.pathname);
    openDiary(diaryOptsForDay(qs.get("diario")));
  }
})();
