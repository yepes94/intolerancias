/* Intolerancias · js/store.js
 * Persistencia 100% local: localStorage (comidas, diario, ajustes; check-ins antiguos solo lectura)
 * + IndexedDB (fotos a tamaño completo). Sin backend. */
(function () {
  "use strict";

  const LS_MEALS = "intol.meals.v1";
  const LS_CHECKINS = "intol.checkins.v1";
  const LS_SETTINGS = "intol.settings.v1";
  const LS_DIETS = "intol.diets.v1";
  const LS_DIARY = "intol.diary.v1";
  const LS_DIARY_MIGRATED = "intol.diary.migrated.v1";
  const LS_REMINDER = "intol.reminder.v1";
  const LS_BOWEL = "intol.bowel.v1";

  const IDB_NAME = "intol-photos";
  const IDB_STORE = "photos";

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn("localStorage lleno o no disponible", e); }
  }

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2));

  // ---- IndexedDB (fotos) ----
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function photoPut(id, dataUrl) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(dataUrl, id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }
  async function photoGet(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const rq = tx.objectStore(IDB_STORE).get(id);
      rq.onsuccess = () => { db.close(); resolve(rq.result || null); };
      rq.onerror = () => reject(rq.error);
    });
  }
  async function photoDel(id) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* sin foto = sin problema */ }
  }

  // ---- Compresión de foto (canvas) ----
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen")); };
      img.src = url;
    });
  }

  // ---- API pública ----
  const Store = {
    getMeals() { return load(LS_MEALS, []); },
    saveMeals(m) { save(LS_MEALS, m); },
    /** Check-ins del sistema anterior: solo se leen para migrarlos y exportarlos. */
    getCheckins() { return load(LS_CHECKINS, []); },
    getDiary() { return load(LS_DIARY, []); },
    saveDiary(d) { save(LS_DIARY, d); },
    diaryMigrated() { return load(LS_DIARY_MIGRATED, false) === true; },
    setDiaryMigrated() { save(LS_DIARY_MIGRATED, true); },
    getReminder() { return load(LS_REMINDER, {}); },
    saveReminder(r) { save(LS_REMINDER, r); },
    getBowel() { return load(LS_BOWEL, []); },
    saveBowel(b) { save(LS_BOWEL, b); },
    getDiets() { return load(LS_DIETS, []); },
    saveDiets(d) { save(LS_DIETS, d); },
    getSettings() {
      const s = Object.assign(
        {
          keys: {},
          preferred: "auto",
          model: window.IntolData.DEFAULT_MODEL,
          groqModel: (window.IntolData && window.IntolData.GROQ_MODEL) || "llama-3.3-70b-versatile",
          reminder: { enabled: true, time: "21:00" }
        },
        load(LS_SETTINGS, {})
      );
      s.reminder = Object.assign({ enabled: true, time: "21:00" }, s.reminder);
      // Antiguo modelo por defecto, retirado por Anthropic el 15-jun-2026.
      if (s.model === "claude-sonnet-4-20250514") s.model = window.IntolData.DEFAULT_MODEL;
      return s;
    },
    saveSettings(s) { save(LS_SETTINGS, s); },
    uid, photoPut, photoGet, photoDel, compressImage,
    wipe() {
      localStorage.removeItem(LS_MEALS);
      localStorage.removeItem(LS_CHECKINS);
      localStorage.removeItem(LS_DIETS);
      localStorage.removeItem(LS_DIARY);
      localStorage.removeItem(LS_DIARY_MIGRATED);
      localStorage.removeItem(LS_REMINDER);
      localStorage.removeItem(LS_BOWEL);
      try {
        const req = indexedDB.deleteDatabase(IDB_NAME);
        req.onsuccess = req.onerror = () => {};
      } catch { /* noop */ }
    }
  };

  window.IntolStore = Store;
})();
