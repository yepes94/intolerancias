# Sistema de diseño · Intolerancias («Gutsy»)

Fondo crema, amarillo de marca, verde salvia, tipografía redondeada grande (Nunito,
autoalojada en `fonts/`), tarjetas suaves muy redondeadas, emojis simpáticos, botones
píldora oscuros y barra inferior oscura. Referencias: `media/referencias-rediseno/` del
Project store.

## Archivos

| Archivo | Qué contiene | ¿Lo tocas en una feature? |
|---|---|---|
| `css/tokens.css` | Fuente + variables (color, tipografía, espacio, radios, sombras) | Solo para añadir un token nuevo |
| `css/components.css` | Reset, base y componentes reutilizables | Rara vez |
| `styles.css` | Estilos de cada pantalla (`/* ---- home ---- */`, `timeline`, …) | Sí: añade una sección propia al final |
| `js/home.js` | Pantalla Home y **registro de tiles** (`IntolHome`) | No: regístrate desde tu JS |

Orden de carga en `index.html`: `tokens.css` → `components.css` → `styles.css`.

**Reglas:** nada de colores, radios ni sombras en crudo; usa los tokens. Emojis como
iconos (`aria-hidden="true"` y texto real al lado). Objetivos táctiles ≥ 44 px.

## Tokens

### Color (semánticos; ya resuelven claro/oscuro con `light-dark()`)

| Token | Uso |
|---|---|
| `--bg` | Fondo de página (crema / casi negro) |
| `--surface` | Tarjetas (`.card`) |
| `--tile` | Tiles, campos, botones secundarios, chips |
| `--sunken` | Hover / zonas hundidas |
| `--field` | Campo con foco |
| `--ink`, `--muted`, `--line` | Texto, texto secundario, separadores |
| `--brand` / `--on-brand` / `--brand-subtle` | Amarillo de marca: hoy, consejo, pestaña activa, FAB |
| `--sage` / `--on-sage` / `--sage-subtle` / `--good` | Verde salvia: días con registro, «sienta bien» |
| `--primary` / `--on-primary` / `--primary-hover` | Botón píldora principal (oscuro en claro, amarillo en oscuro) |
| `--accent` / `--accent-subtle` / `--on-accent` | Marrones: datos, «a vigilar», gráficos |
| `--bad` / `--bad-subtle` | Error, «sienta mal», borrar |
| `--ia` / `--ia-subtle` | Contenido generado por IA |
| `--nav-bg`, `--nav-ink`, `--nav-ink-active` | Barra inferior (siempre oscura) |
| `--focus` | Anillo de foco |

Paleta cruda (`--palette-*`: cream, yellow, sage, ink, brown, cocoa…) solo para
ilustraciones o gráficos donde el tono deba ser fijo en ambos modos.

### Tipografía

`--font` (Nunito → ui-rounded → system). Tamaños: `--text-xs` 13 · `--text-s` 15 ·
`--text-m` 17 (cuerpo) · `--text-l` 21 (título de tarjeta/tile) · `--text-xl` 26–32
(título de pantalla, `h2`) · `--text-2xl` 32–40 (saludo Home). Pesos:
`--weight-regular` 500 · `--weight-bold` 750 · `--weight-black` 850 (títulos).

### Espacio, radios, sombras

- Espacio (4 px): `--space-2xs` 4 · `xs` 8 · `s` 12 · `m` 16 · `l` 24 · `xl` 32 · `2xl` 48.
- Radios: `--radius-s` 12 · `--radius-m` 20 (tiles, inputs) · `--radius-l` 28 (tarjetas) ·
  `--radius-xl` 36 (sheets) · `--radius-pill`.
- Sombras: `--shadow-s`, `--shadow-m` (tarjetas en claro; en oscuro se usa borde `--line`),
  `--shadow-l` (sheet, barra flotante).
- Layout: `--content-max` (40rem), `--nav-h` (alto de la barra inferior, ya reservado en `main`).

### Modo claro / oscuro

Sigue al sistema. Ajustes → «Apariencia» fuerza `data-theme="light|dark"` en `<html>`
(guardado en `localStorage["intol.theme"]`). Con tokens semánticos no hay que hacer nada
más; si necesitas un valor propio, usa `light-dark(claro, oscuro)`.

## Componentes

```html
<!-- Tarjeta -->
<div class="card"><h3>Título <small>subtítulo</small></h3><p class="hint">…</p></div>

<!-- Consejo amarillo -->
<div class="tip"><span class="tip-icon" aria-hidden="true">💡</span><p>Texto</p></div>

<!-- Tiles 2×2 (.is-wide ocupa la fila) -->
<div class="tiles">
  <button class="tile" type="button">
    <span class="tile-emoji" aria-hidden="true">🥣</span>
    <span class="tile-title">Comida</span>
    <span class="tile-desc">Registra lo que comes</span>
  </button>
</div>

<!-- Botones píldora -->
<button class="btn primary">Guardar</button>      <!-- oscuro: acción principal -->
<button class="btn brand">Gutsy</button>          <!-- amarillo: destacado -->
<button class="btn">Secundario</button>
<button class="btn ghost small">Cancelar</button>
<button class="btn danger small">Borrar</button>
<button class="icon-btn" aria-label="Siguiente">→</button>

<!-- Chips (selección) y pills (etiquetas) -->
<div class="chips"><button class="chip" aria-pressed="true">Gases</button></div>
<div class="pills"><span class="pill is-sage">Bien</span><span class="pill is-brand">Hoy</span></div>

<!-- Campos -->
<label class="field"><span>Etiqueta <small>ayuda</small></span><input type="text" /></label>
<div class="segmented"><label><input type="radio" name="x" checked /><span>A</span></label>…</div>
<div class="feeling-row">…5 botones con aria-pressed…</div>

<!-- Sheet (bottom sheet en móvil, modal en desktop) -->
<dialog class="sheet" closedby="any">
  <header class="sheet-head"><h3>Título</h3><p class="hint">…</p></header>
  <div class="sheet-body">…</div>
  <footer class="sheet-foot row"><button class="btn primary">OK</button><button class="btn ghost">Cancelar</button></footer>
</dialog>
```

Barra inferior: `<nav class="tabbar">` con `<button class="tab" data-tab="x">` +
`.tab-icon` + `.tab-label`; la activa lleva `aria-current="page"`. Cada pestaña muestra
`<section id="tab-x" class="panel">`. Para abrir una pestaña desde JS:
`IntolHome.showTab("registrar")`.

## Home: registro de tiles (para workers de features)

`js/home.js` expone `window.IntolHome`. Deposición, Ánimo y sueño y Bebida ya existen
como placeholders «Próximamente». Para conectar tu feature, en tu JS (cargado después de
`js/home.js`):

```js
IntolHome.registerTile({
  id: "deposicion",            // deposicion | animo | comida | bebida | diario | tuyo
  emoji: "💩",
  title: "Deposición",
  desc: "Registra tus deposiciones a lo largo del día",
  onOpen: () => abrirMiSheet(),  // sin onOpen → «Próximamente»
  // opcional: timestamps (ms) de tus registros, para marcar días en la tira semanal
  records: () => misRegistros.map((r) => r.at),
});
IntolHome.refresh();           // tras guardar un registro, para repintar la semana
```

- Mismo `id` = sustituye al placeholder manteniendo su posición (`order`: deposición 10,
  ánimo 20, comida 30, bebida 40, diario 50). `wide: true` ocupa la fila entera.
- `IntolHome.showTab(name)` cambia de pestaña; `IntolHome.tips` es la lista de consejos.
- Si tu feature tiene pantalla propia, añade una pestaña solo si es imprescindible
  (la barra ya tiene 6); preferible un sheet abierto desde el tile.

## Capturas de referencia del rediseño

`media/rediseno/` del Project store: cada pantalla a 375×667, 390×844 y 1280×800, en claro y oscuro.
