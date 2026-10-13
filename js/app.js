/* Intolerancias · js/app.js — UI + recordatorios + resumen local. */
(function () {
  "use strict";

  const S = window.IntolStore;
  const P = window.IntolProviders;
  const D = window.IntolData;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- estado ----------
  let meals = S.getMeals();
  let checkins = S.getCheckins();
  let settings = S.getSettings();
  let draftPhoto = null;      // dataURL comprimida (full) pendiente de guardar
  let draftThumb = null;
  let activeMealFeeling = 3;
  let modalFeeling = 3;
  let modalCheckinId = null;  // check-in programado que se está respondiendo
  let modalMealId = null;
  let modalSymptoms = new Set();

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
  function fmtIn(ms) {
    if (ms <= 0) return "ahora";
    const m = Math.round(ms / 60000);
    if (m < 60) return "en " + m + " min";
    const h = Math.floor(m / 60);
    if (h < 24) return "en " + h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
    return "en " + Math.floor(h / 24) + " d";
  }
  function persist() { S.saveMeals(meals); S.saveCheckins(checkins); }
  function mealById(id) { return meals.find((m) => m.id === id); }

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => {
        x.classList.remove("active"); x.setAttribute("aria-selected", "false");
      });
      b.classList.add("active"); b.setAttribute("aria-selected", "true");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $("tab-" + b.dataset.tab).classList.add("active");
      if (b.dataset.tab === "timeline") renderTimeline();
      if (b.dataset.tab === "resumen") renderSummary();
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
  wireFeeling("checkinFeeling", () => modalFeeling, (v) => { modalFeeling = v; });

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

  // ---------- guardar comida + programar check-ins ----------
  $("saveMealBtn").addEventListener("click", async () => {
    const desc = $("mealDesc").value.trim();
    if (!desc && !draftPhoto) { toast("Describe qué comiste o sube una foto"); return; }
    const local = P.localAnalyze(desc);
    // Ingredientes del último análisis IA (si coincide con esta descripción).
    let iaIds = [];
    try { iaIds = JSON.parse($("analysisResult").dataset.ingredients || "[]"); }
    catch { iaIds = []; }
    $("analysisResult").dataset.ingredients = "";
    const meal = {
      id: S.uid(),
      createdAt: Date.now(),
      description: desc,
      feeling0: activeMealFeeling,
      ingredients: local.ingredients.map((id) => ({ id, source: "local" })),
      thumb: draftThumb || null,
      analysis: null
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
    scheduleCheckins(meal);
    persist();
    $("mealDesc").value = "";
    $("photoClear").click();
    toast("Comida guardada · check-ins programados");
    renderUpcoming();
    renderTimeline();
  });

  function scheduleCheckins(meal) {
    // Genéricos + uno por ventana de ingrediente (inicio y fin), topados.
    const now = Date.now();
    const plans = [
      { at: now + 2 * 3600e3, q: "Han pasado ~2 h. ¿Cómo te sientes?" },
      { at: now + 6 * 3600e3, q: "Han pasado ~6 h. ¿Alguna molestia digestiva?" },
      { at: now + 24 * 3600e3, q: "Ha pasado 1 día. ¿Cómo te sienta aquello que comiste?" }
    ];
    for (const ing of meal.ingredients) {
      const w = D.ONSET_WINDOWS[ing.id];
      if (!w) continue;
      plans.push({ at: meal.createdAt + w.startH * 3600e3, q: `Ventana de ${w.label} (desde ${fmtH(w.startH)}). ¿Cómo te sientes?` });
      if (w.endH <= 12) plans.push({ at: meal.createdAt + w.endH * 3600e3, q: `Fin de ventana de ${w.label}. ¿Algo que reportar?` });
    }
    // De-duplicar por cercanía (<20 min) y topar a 5 por comida.
    plans.sort((a, b) => a.at - b.at);
    const dedup = [];
    for (const p of plans) {
      if (p.at < now - 60e3) continue;
      if (dedup.some((d) => Math.abs(d.at - p.at) < 20 * 60e3)) continue;
      dedup.push(p);
      if (dedup.length >= 5) break;
    }
    for (const p of dedup) {
      checkins.push({ id: S.uid(), mealId: meal.id, scheduledAt: Math.max(p.at, now + 5000), prompt: p.q, doneAt: null });
    }
    armTimers();
  }

  function fmtH(h) {
    if (h < 1) return Math.round(h * 60) + " min";
    return h + " h";
  }

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
        "<br><strong>Pregunta de seguimiento:</strong> " + esc(out.checkinQuestion || "¿Cómo te sientes?");
      // Fusiona ingredientes detectados por IA en la próxima comida guardada
      box.dataset.ingredients = JSON.stringify(out.ingredients || []);
    } catch (err) {
      box.innerHTML = "⚠️ " + esc(err.message) +
        "<br><span class='hint'>Revisa tu clave en Ajustes. Si el navegador bloquea la llamada (CORS/red), " +
        "el análisis local sigue funcionando.</span>";
    }
  });

  // ---------- notificaciones ----------
  $("enableNotifBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) { toast("Este navegador no soporta notificaciones"); return; }
    const perm = await Notification.requestPermission();
    toast(perm === "granted" ? "Notificaciones activadas" : "Permiso: " + perm);
    renderUpcoming();
  });

  let timerIds = [];
  function armTimers() {
    timerIds.forEach(clearTimeout);
    timerIds = [];
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    for (const c of checkins.filter((c) => !c.doneAt)) {
      const delay = c.scheduledAt - now;
      if (delay > 0 && delay < 7 * 24 * 3600e3) {
        timerIds.push(setTimeout(() => fireNotification(c), delay));
      }
    }
  }
  function fireNotification(c) {
    const meal = mealById(c.mealId);
    try {
      const n = new Notification("Intolerancias · ¿cómo te sientes?", {
        body: (meal ? (meal.description || "Tu comida") + " — " : "") + c.prompt,
        tag: c.id
      });
      n.onclick = () => { window.focus(); openCheckin(c.id); };
    } catch { /* permiso revocado: el aviso in-app sigue visible */ }
    renderUpcoming();
  }
  // Polling in-app (cubre timers perdidos + sirve sin permiso de Notification).
  setInterval(() => {
    const due = checkins.some((c) => !c.doneAt && c.scheduledAt <= Date.now());
    renderUpcoming();
    if (due && $("checkinModal").open) return;
    const first = checkins.filter((c) => !c.doneAt && c.scheduledAt <= Date.now())
      .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    if (first && document.visibilityState === "visible" && !sessionStorage.getItem("intol.nag." + first.id)) {
      sessionStorage.setItem("intol.nag." + first.id, "1");
      toast("⏰ Tienes un check-in pendiente");
    }
  }, 30000);

  function pendingCheckins() {
    return checkins.filter((c) => !c.doneAt).sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  function renderUpcoming() {
    const ul = $("upcomingList");
    const pend = pendingCheckins().slice(0, 6);
    const badge = $("pendingBadge");
    const overdue = checkins.filter((c) => !c.doneAt && c.scheduledAt <= Date.now()).length;
    badge.textContent = overdue ? overdue : "";
    badge.classList.toggle("hidden", !overdue);
    if (!pend.length) { ul.innerHTML = "<li class='empty'>Sin check-ins pendientes. ¡Buen provecho! 🎉</li>"; return; }
    ul.innerHTML = "";
    for (const c of pend) {
      const meal = mealById(c.mealId);
      const li = document.createElement("li");
      if (c.scheduledAt <= Date.now()) li.classList.add("overdue");
      li.innerHTML = "<span class='checkin-text'>⏰ <strong>" + esc(c.scheduledAt <= Date.now() ? "ahora" : fmtIn(c.scheduledAt - Date.now())) +
        "</strong> · " + esc(c.prompt) +
        (meal && meal.description ? "<span class='checkin-meal hint'>" + esc(meal.description) + "</span>" : "") + "</span>";
      const btn = document.createElement("button");
      btn.className = "btn small"; btn.textContent = "Responder";
      btn.addEventListener("click", () => openCheckin(c.id));
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  // ---------- modal check-in ----------
  function symptomChips() {
    const wrap = $("symptomChips");
    wrap.innerHTML = "";
    for (const s of D.SYMPTOMS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (modalSymptoms.has(s) ? " sel" : "");
      b.setAttribute("aria-pressed", String(modalSymptoms.has(s)));
      b.textContent = s;
      b.addEventListener("click", () => {
        modalSymptoms.has(s) ? modalSymptoms.delete(s) : modalSymptoms.add(s);
        b.setAttribute("aria-pressed", String(b.classList.toggle("sel")));
      });
      wrap.appendChild(b);
    }
  }

  function openCheckin(checkinId, mealId) {
    modalCheckinId = checkinId || null;
    modalMealId = mealId || (checkinId && checkins.find((c) => c.id === checkinId)?.mealId) || latestMealId();
    modalFeeling = 3; modalSymptoms = new Set();
    $("checkinFeeling").querySelectorAll("button").forEach((x) => {
      x.classList.toggle("sel", x.dataset.v === "3");
      x.setAttribute("aria-pressed", String(x.dataset.v === "3"));
    });
    $("checkinNote").value = "";
    symptomChips();
    const meal = modalMealId && mealById(modalMealId);
    $("checkinCtx").textContent = meal
      ? "Sobre: " + (meal.description || "comida") + " (" + fmtDT(meal.createdAt) + ")"
      : "Registro general de cómo estás.";
    if (!$("checkinModal").open) $("checkinModal").showModal();
  }

  function latestMealId() {
    return meals.length ? meals[0].id : null;
  }

  $("quickCheckinBtn").addEventListener("click", () => openCheckin(null, null));
  $("checkinClose").addEventListener("click", () => $("checkinModal").close());
  $("checkinSnooze").addEventListener("click", () => {
    if (modalCheckinId) {
      const c = checkins.find((x) => x.id === modalCheckinId);
      if (c) c.scheduledAt = Date.now() + 30 * 60e3;
      persist();
    }
    $("checkinModal").close();
    renderUpcoming(); toast("Pospuesto 30 min");
  });
  $("checkinSave").addEventListener("click", () => {
    if (modalCheckinId) {
      const c = checkins.find((x) => x.id === modalCheckinId);
      if (c) {
        c.doneAt = Date.now();
        c.feeling = modalFeeling;
        c.symptoms = [...modalSymptoms];
        c.note = $("checkinNote").value.trim();
      }
    } else {
      checkins.push({
        id: S.uid(), mealId: modalMealId, scheduledAt: Date.now(), doneAt: Date.now(),
        prompt: "Registro espontáneo", feeling: modalFeeling,
        symptoms: [...modalSymptoms], note: $("checkinNote").value.trim()
      });
    }
    persist();
    $("checkinModal").close();
    renderUpcoming(); renderTimeline(); renderSummary();
    toast(modalFeeling <= 2 ? "Vaya 😟 · registrado. ¡Cuídate!" : "Registrado ✔");
  });

  // ---------- timeline ----------
  async function renderTimeline() {
    const wrap = $("timeline");
    if (!meals.length) { wrap.innerHTML = "<p class='empty'>Aún no hay comidas. Registra la primera en la pestaña ＋ Registrar.</p>"; return; }
    wrap.innerHTML = "";
    for (const m of meals.slice(0, 50)) {
      const card = document.createElement("article");
      card.className = "meal";
      const ings = m.ingredients.map((i) => {
        const w = D.ONSET_WINDOWS[i.id];
        return "<span class='pill src-" + esc(i.source) + "' title='" + esc(w ? w.hint : "") + "'>" +
          esc(w ? w.label : i.id) + "</span>";
      }).join("");
      const follows = checkins.filter((c) => c.mealId === m.id && c.doneAt)
        .sort((a, b) => a.doneAt - b.doneAt);
      const face = ["", "😖", "🙁", "😐", "🙂", "😄"][m.feeling0] || "😐";
      card.innerHTML =
        "<header class='meal-head'>" +
        (m.thumb ? "<img class='meal-thumb' alt='Foto de la comida' src='" + m.thumb + "' data-full='" + m.id + "' loading='lazy' />" : "") +
        "<div class='meal-title'><strong>" + esc(m.description || "(solo foto)") + "</strong>" +
        "<time datetime='" + new Date(m.createdAt).toISOString() + "'>" + fmtDT(m.createdAt) + "</time></div></header>" +
        "<p class='meal-feeling'>Al comer: " + face + " <span class='score'>" + m.feeling0 + "/5</span></p>" +
        (ings ? "<div class='pills'>" + ings + "</div>" : "") +
        "<div class='follow'>" +
        (follows.length
          ? "<ul class='follow-list'>" + follows.map((c) => "<li>✔ <time>" + fmtDT(c.doneAt) + "</time> → <strong class='score'>" + c.feeling + "/5</strong> " +
            esc((c.symptoms || []).join(", ")) + (c.note ? " · “" + esc(c.note) + "”" : "") + "</li>").join("") + "</ul>"
          : "<span class='hint'>Sin check-ins respondidos todavía.</span>") +
        "</div>";
      const row = document.createElement("div");
      row.className = "row";
      const b1 = document.createElement("button");
      b1.className = "btn small ghost"; b1.textContent = "＋ check-in";
      b1.addEventListener("click", () => openCheckin(null, m.id));
      const b2 = document.createElement("button");
      b2.className = "btn small ghost"; b2.textContent = "Borrar";
      b2.addEventListener("click", async () => {
        if (!confirm("¿Borrar esta comida y sus check-ins?")) return;
        meals = meals.filter((x) => x.id !== m.id);
        checkins = checkins.filter((x) => x.mealId !== m.id);
        await S.photoDel(m.id);
        persist(); renderTimeline(); renderUpcoming(); renderSummary();
      });
      row.append(b1, b2);
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

  // ---------- resumen ----------
  function stats() {
    // ingId -> {n, sum, bad}
    const acc = {};
    for (const m of meals) {
      const rel = checkins.filter((c) => c.mealId === m.id && c.doneAt && c.feeling != null);
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
        "<span class='hint'>Ejemplos: " + esc(w ? w.hint : "") + ". " + esc(D.DISCLAIMER) + "</span>";
      sug.appendChild(div);
    }
  }

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ meals, checkins, exportedAt: new Date().toISOString() }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "intolerancias-datos.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("wipeBtn").addEventListener("click", () => {
    if (!confirm("¿Borrar TODOS los datos locales (comidas, check-ins, fotos)?")) return;
    S.wipe(); meals = []; checkins = [];
    persist(); renderTimeline(); renderUpcoming(); renderSummary();
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
    } catch (err) { $("providerMsg").textContent = "⚠️ " + err.message; }
  });

  // ---------- init ----------
  renderUpcoming();
  renderTimeline();
  renderProviderStatus();
  armTimers();
})();
