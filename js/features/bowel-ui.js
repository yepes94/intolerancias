/* Intolerancias · js/features/bowel-ui.js
 * UI del registro de deposiciones (escala de Bristol): hoja de registro, tarjeta de timeline y
 * reparto de tipos del Resumen. La lógica pura vive en js/features/bowel.js. */
(function () {
  "use strict";

  const B = window.IntolBowel;
  const esc = (s) => String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SHAPES = {
    1: '<circle cx="12" cy="24" r="7"/><circle cx="30" cy="14" r="5"/><circle cx="41" cy="28" r="6"/><circle cx="56" cy="17" r="6"/><circle cx="64" cy="31" r="4"/>',
    2: '<circle cx="14" cy="21" r="9"/><circle cx="27" cy="19" r="10"/><circle cx="41" cy="21" r="9"/><circle cx="55" cy="20" r="9"/><rect x="14" y="14" width="42" height="14" rx="4"/>',
    3: '<rect x="6" y="11" width="60" height="18" rx="9"/><path class="bw-crack" d="M20 11l3 7M34 11l-2 8M48 11l3 6M27 29l2-6M42 29l-1-7"/>',
    4: '<path d="M9 27Q36 7 63 27" fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round"/>',
    5: '<circle cx="14" cy="24" r="8"/><circle cx="31" cy="15" r="6"/><circle cx="46" cy="27" r="7"/><circle cx="60" cy="16" r="5"/>',
    6: '<path d="M5 33L9 21l6 10 5-17 6 17 8-15 6 15 8-13 5 13 6-9 4 10z"/>',
    7: '<path d="M3 31Q14 22 25 31T47 31T69 31V37H3z"/><circle cx="20" cy="14" r="3"/><circle cx="46" cy="10" r="2.5"/><circle cx="58" cy="19" r="2"/>'
  };

  function art(type, size) {
    return '<svg class="bw-art" data-type="' + type + '" viewBox="0 0 72 40" width="' + (size || 56) + '" height="' + Math.round((size || 56) * 40 / 72) +
      '" aria-hidden="true" focusable="false" fill="currentColor">' + SHAPES[type] + "</svg>";
  }

  let ctx = null;
  let dialog = null;
  let draft = null;

  function toLocalInput(ts) {
    const d = new Date(ts);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function buildDialog() {
    const d = document.createElement("dialog");
    d.id = "bowelModal";
    d.className = "sheet bw-modal";
    d.setAttribute("aria-labelledby", "bowelTitle");
    d.setAttribute("closedby", "any");
    d.innerHTML =
      "<header class='sheet-head'><h3 id='bowelTitle'>💩 Deposición</h3>" +
      "<p class='hint'>Elige el tipo que más se parezca (escala de Bristol).</p></header>" +
      "<div class='sheet-body'>" +
      "<div class='bw-types' id='bowelTypes' role='group' aria-label='Tipo de Bristol'>" +
      B.TYPES.map((t) =>
        "<button type='button' class='bw-type' data-type='" + t.type + "' data-cat='" + t.cat + "' aria-pressed='false'>" +
        art(t.type, 64) +
        "<span class='bw-type-n'>" + t.type + "</span>" +
        "<span class='bw-type-name'>" + esc(t.short) + "</span>" +
        "<span class='bw-type-cat'>" + esc(B.CATS[t.cat].label) + "</span></button>").join("") +
      "</div>" +
      "<p class='bw-explain' id='bowelExplain' aria-live='polite'>Toca un tipo para ver qué significa.</p>" +
      "<label class='field'><span>Hora</span><input type='datetime-local' id='bowelAt' /></label>" +
      "<div class='field'><span id='bowelFlagsLabel'>Marcas rápidas <small>(opcional)</small></span>" +
      "<div class='chips bw-flags' id='bowelFlags' role='group' aria-labelledby='bowelFlagsLabel'>" +
      B.FLAGS.map((f) => "<button type='button' class='chip bw-flag' data-flag='" + f.id + "' aria-pressed='false'>" +
        "<span aria-hidden='true'>" + f.emoji + "</span> " + f.label + "</button>").join("") +
      "</div></div>" +
      "<p class='bw-alert hidden' id='bowelAlert' role='alert'>🩸 " + esc(B.BLOOD_ADVICE) + "</p>" +
      "<label class='field'><span>Nota <small>(opcional)</small></span>" +
      "<textarea id='bowelNote' rows='2' maxlength='280' placeholder='Ej.: después de comer fuera, tras el café…'></textarea></label>" +
      "</div>" +
      "<footer class='sheet-foot row'>" +
      "<button type='button' class='btn primary' id='bowelSave'>Guardar</button>" +
      "<button type='button' class='btn ghost' id='bowelCancel'>Cancelar</button></footer>";
    document.body.appendChild(d);

    d.querySelectorAll(".bw-type").forEach((b) => b.addEventListener("click", () => { draft.type = Number(b.dataset.type); paint(); }));
    d.querySelectorAll(".bw-flag").forEach((b) => b.addEventListener("click", () => { draft[b.dataset.flag] = !draft[b.dataset.flag]; paint(); }));
    d.querySelector("#bowelCancel").addEventListener("click", () => d.close());
    d.querySelector("#bowelSave").addEventListener("click", save);
    d.addEventListener("close", () => { if (ctx && ctx.onClose) ctx.onClose(); });
    return d;
  }

  function paint() {
    dialog.querySelectorAll(".bw-type").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.type) === draft.type)));
    dialog.querySelectorAll(".bw-flag").forEach((b) => b.setAttribute("aria-pressed", String(!!draft[b.dataset.flag])));
    const info = B.typeInfo(draft.type);
    dialog.querySelector("#bowelExplain").innerHTML = info
      ? "<strong>Tipo " + info.type + " · " + esc(B.CATS[info.cat].label) + "</strong> " + esc(info.desc)
      : "Toca un tipo para ver qué significa.";
    dialog.querySelector("#bowelAlert").classList.toggle("hidden", !draft.blood);
  }

  function save() {
    if (!B.validType(draft.type)) { ctx.toast("Elige un tipo de la escala de Bristol"); return; }
    const at = new Date(dialog.querySelector("#bowelAt").value).getTime();
    const s = B.make({
      type: draft.type, at: isFinite(at) ? at : Date.now(), note: dialog.querySelector("#bowelNote").value,
      pain: draft.pain, urgency: draft.urgency, blood: draft.blood
    });
    ctx.setStools([s].concat(ctx.getStools()).sort((a, b) => b.at - a.at || b.createdAt - a.createdAt));
    dialog.close();
    ctx.toast(B.redFlag(s) ? "Registrado · con sangre conviene consultar a un profesional" : "Deposición registrada", B.redFlag(s) ? 5000 : 2600);
    ctx.onChange();
  }

  function open(opts) {
    if (!ctx) return;
    if (!dialog) dialog = buildDialog();
    const o = opts || {};
    draft = { type: null, pain: false, urgency: false, blood: false };
    const now = Date.now();
    dialog.querySelector("#bowelAt").value = toLocalInput(o.at || now);
    dialog.querySelector("#bowelAt").max = toLocalInput(now + 60e3);
    dialog.querySelector("#bowelNote").value = "";
    paint();
    if (!dialog.open) {
      if (ctx.lockScroll) ctx.lockScroll();
      dialog.showModal();
      dialog.querySelector(".sheet-body").scrollTop = 0;
    }
  }

  /** Tarjeta del timeline. */
  function card(s, onDelete) {
    const info = B.typeInfo(s.type);
    const cat = B.CATS[info.cat];
    const el = document.createElement("article");
    el.className = "meal bowel-entry" + (B.isAbnormal(s) ? " is-bad" : "");
    el.id = "stool-" + s.id;
    const flags = B.flagsOf(s);
    el.innerHTML =
      "<header class='meal-head'><span class='bw-card-art'>" + art(s.type, 56) + "</span>" +
      "<div class='meal-title'><strong>Deposición · tipo " + s.type + "</strong>" +
      "<time datetime='" + new Date(s.at).toISOString() + "'>" + esc(ctx.fmtDT(s.at)) + "</time></div></header>" +
      "<p class='bw-card-desc'><span class='bw-cat' data-tone='" + cat.tone + "'>" + esc(cat.label) + "</span> " + esc(info.name) + "</p>" +
      (flags.length ? "<div class='pills'>" + flags.map((f) => "<span class='pill src-sym'>" + f.emoji + " " + f.label + "</span>").join("") + "</div>" : "") +
      (s.note ? "<p class='diary-text'>" + esc(s.note) + "</p>" : "") +
      (B.redFlag(s) ? "<p class='bw-alert' role='note'>🩸 " + esc(B.BLOOD_ADVICE) + "</p>" : "");
    const row = document.createElement("div");
    row.className = "row";
    const del = document.createElement("button");
    del.className = "btn small ghost";
    del.textContent = "Borrar";
    del.addEventListener("click", () => {
      if (confirm("¿Borrar esta deposición?")) onDelete(s);
    });
    row.appendChild(del);
    el.appendChild(row);
    return el;
  }

  /** Reparto de tipos (últimos 30 días) en el Resumen. */
  function renderSummary(el, stools) {
    const dist = B.distribution(stools, Date.now(), 30);
    if (!dist.total) {
      el.innerHTML = "<p class='empty'>Aún no hay deposiciones en los últimos 30 días. Regístralas desde «Deposición».</p>";
      return;
    }
    const max = Math.max(...dist.counts);
    const rows = B.TYPES.map((t) => {
      const n = dist.counts[t.type - 1];
      return "<li class='bw-bar' data-cat='" + t.cat + "'><span class='bw-bar-label'>" + art(t.type, 40) +
        "<span class='bw-bar-n'>" + t.type + "</span></span>" +
        "<span class='bw-bar-track' role='img' aria-label='Tipo " + t.type + ": " + n + "'><span class='bw-bar-fill' style='width:" + (max ? Math.round(n / max * 100) : 0) + "%'></span></span>" +
        "<span class='bw-bar-count'>" + n + "</span></li>";
    }).join("");
    const pct = (k) => Math.round(dist.byCat[k] / dist.total * 100);
    const top = B.typeInfo(dist.top);
    const marks = [dist.pain ? dist.pain + " con dolor" : "", dist.urgency ? dist.urgency + " con urgencia" : "", dist.blood ? dist.blood + " con sangre" : ""].filter(Boolean);
    el.innerHTML =
      "<p class='hint'>" + dist.total + " deposición(es) en 30 días · lo más frecuente: tipo " + top.type + " (" + esc(top.short.toLowerCase()) + ")</p>" +
      "<ul class='bw-bars'>" + rows + "</ul>" +
      "<p class='bw-split'>Normal " + pct("normal") + "% · Estreñimiento " + pct("constipation") + "% · Blanda " + pct("soft") + "% · Diarrea " + pct("diarrhea") + "%</p>" +
      (marks.length ? "<p class='hint'>Marcas: " + marks.join(", ") + ".</p>" : "") +
      (dist.blood ? "<p class='bw-alert' role='note'>🩸 " + esc(B.BLOOD_ADVICE) + "</p>" : "");
  }

  /** ctx: { getStools, setStools, toast, fmtDT, onChange, lockScroll? } */
  function init(c) {
    ctx = c;
    if (window.IntolHome && typeof window.IntolHome.registerTile === "function") {
      window.IntolHome.registerTile({
        id: "deposicion", emoji: "💩", title: "Deposición",
        desc: "Registra tus deposiciones a lo largo del día",
        onOpen: () => open(),
        records: () => ctx.getStools().map((s) => s.at)
      });
      window.IntolHome.refresh();
    }
  }

  window.IntolBowelUI = { init, open, card, renderSummary, art };
})();
