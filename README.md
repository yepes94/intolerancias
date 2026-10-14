# 🌿 Intolerancias

Diario personal de comidas y bienestar. **100% frontend, sin backend, sin cuentas, sin perfiles.**
Todo vive en tu navegador: `localStorage` (comidas, diario, ajustes) + `IndexedDB` (fotos).

Registras qué comes (foto y/o texto) y, cuando te sientes mal, lo cuentas con tus palabras en el
**diario de síntomas**. La app —con IA opcional (BYOK) o con un análisis local— lo cruza con lo
que comiste en las 24 h anteriores, te dice qué puede estar detrás y te sugiere descartes
(*“prueba a no comer X”*). Si un día registras comidas y no escribes nada, te lo recuerda a las 21:00.

## Probar en local

```bash
python3 -m http.server 8080   # o: npx serve .
```

Abre http://localhost:8080 (también abre con doble clic en `index.html`, con funciones degradadas).

Plan de verificación manual paso a paso: [docs/verificacion.md](docs/verificacion.md).
Sistema de diseño (tokens, componentes, tiles de Home): [docs/diseno.md](docs/diseno.md).

> **Gate de aceptación:** sin toda la evidencia marcada en la descripción del PR
> (plantilla `.github/pull_request_template.md`) no se pasa de draft a ready ni se
> pide review. PR sin evidencia completa = draft.

## IA (BYOK, opcional)

Pestaña **⚙️ Ajustes** → pega tu clave → se guarda **solo en el localStorage** de tu navegador.
Prioridad automática: **Claude > Hermes > Groq > Cursor**.

| Proveedor | Estado |
|---|---|
| Claude (Anthropic, visión + chat) | ✅ Implementado |
| Hermes | 🔧 Stub (misma interfaz, pendiente) |
| Groq (texto + visión, gratis) | ✅ Implementado |
| Cursor | 🔧 Stub (misma interfaz, pendiente) |

- **Groq**: crea tu clave gratis en <https://console.groq.com/keys> (empieza por `gsk-…`),
  pégala en Ajustes → **Guardar claves** → **Probar conexión**. Sin foto usa el
  **Modelo Groq** configurable (por defecto `llama-3.3-70b-versatile`); con foto usa
  visión automáticamente.
- **Claude**: clave en <https://console.anthropic.com/settings/keys> (`sk-ant-…`).

Sin clave, funciona el **análisis local por palabras clave** (offline). Para añadir un
proveedor basta implementar `ping` + `analyzeFood` (+ `planDiet`) en `js/providers.js`, sin refactorizar.

## Diario de síntomas

Botón flotante **📝 ¿Cómo te sientes?** en cualquier pestaña: texto libre, hora (por defecto
ahora) y nivel 1–5 opcional. Al guardar, la app manda el texto y las comidas de las 24 h
anteriores (descripción, análisis y componentes guardados; sin fotos) al proxy
`/api/diary` con tu clave BYOK; sin clave, o si la IA falla, hace un análisis local por
coincidencias (componente × ventana típica × síntomas). El resultado se guarda en la entrada
(`intol.diary.v1`) y se ve en el timeline. Los check-ins del sistema anterior se migran como
entradas «históricas».

**Recordatorio (21:00 por defecto, en Ajustes):** si ese día hay comidas y el diario está
vacío, banner en la app y aviso del sistema con la app abierta o en segundo plano
(service worker `sw.js`, solo notificaciones, sin caché). Con la app cerrada no hay aviso
(haría falta Web Push con servidor); al abrirla se ve el pendiente.

## Deposiciones (escala de Bristol)

Tile **💩 Deposición** del Home: elige el tipo 1–7 (ilustración + explicación corta:
estreñimiento, normal, diarrea…), hora, nota opcional y marcas rápidas (dolor, urgencia,
sangre → recomienda consultar). Se guarda en `localStorage` (`intol.bowel.v1`), sale en el
timeline y en la exportación JSON (`bowel`) y se borra con «Borrar todo». Alimenta como
señal digestiva el diario (`/api/diary` recibe las deposiciones de las 24 h anteriores; el
análisis local también las usa), la dieta (`/api/diet` recibe un resumen de 14 días y
las deposiciones anómalas cuentan como síntoma tras las comidas previas) y el Resumen
muestra la distribución de tipos de 30 días.

## Ánimo y sueño

Tile **Ánimo y sueño** del Home (y tarjeta en Registrar): un toque en una de las 5 caritas guarda
el ánimo de hoy; un segundo toque en el sheet añade etiquetas (estrés, cansancio, ansiedad,
tristeza, irritable, energía, calma, motivación), horas dormidas (4–9 h o con −/+ de media hora)
y calidad del sueño 1–5. Todo se guarda al tocar, para «Hoy» o «Ayer», en `localStorage`
(`intol.moodsleep.v1`, un registro por día). Sale en el timeline, en **Exportar datos** (`moodSleep`)
y **Borrar todo** lo elimina.

Alimenta al análisis como contexto, no como causa: el diario manda a `/api/diary` el ánimo y el
sueño del día de la entrada (`wellbeing`) y la dieta manda a `/api/diet` el resumen de la última
semana (`context.wellbeing`, con las coincidencias «poco sueño / estrés ↔ días con malestar»);
sin IA, el análisis local del diario añade una línea de contexto y el plan local de la dieta
consejos de sueño y estrés. **Resumen** muestra la tendencia de 7 días (ánimo, horas, calidad,
etiquetas frecuentes y cambio frente a la semana anterior).

## Dieta de prueba con IA

Pestaña **🥗 Dieta**: pide un día completo (desayuno, comida, merienda, cena) o una sola
comida. Si tus registros asocian un componente (p. ej. gluten, lactosa) con hinchazón,
pesadez, gases o cansancio, el plan lo excluye y prioriza comidas con energía y poca
pesadez; si no hay señales claras, propone una dieta equilibrada y ligera. Cada comida
trae hora, ingredientes con cantidades, pasos de preparación, por qué ayuda, una
alternativa y qué observar después; el plan incluye lista de la compra y se puede
compartir o copiar. La respuesta de la IA no tiene tope propio de tokens. Los planes se
guardan en `localStorage` (`intol.diets.v1`); «Comí esto» y «Registrar cómo me siento»
los enlazan con el diario para comparar con/sin plan. Sin clave hay plan local de ejemplo.

## Bebidas

Tarjeta **🥤 Bebidas** en Registrar: 11 botones rápidos (agua, café, té, leche,
bebida vegetal, refresco, zumo, cerveza, vino, destilado y otra) con cantidad
(vaso 250 ml, taza 200 ml, copa, chupito o ml libres) y hora. Cada tipo se mapea a
los componentes de siempre (cafeína, lactosa, soja, fructosa, alcohol, gluten en
la cerveza, histamina en el vino) y cuenta en el diario, la dieta y el Resumen.
El **Resumen** muestra la hidratación del día (solo el agua suma) con objetivo
configurable (2000 ml por defecto) y los componentes aportados por bebidas.
Viven en `localStorage` (`intol.drinks.v1`), salen en el timeline y en la
exportación, y se borran con «Borrar todo». La lógica pura está en
`js/features/drinks.js`; cuando el Home del rediseño (`docs/diseno.md`) exista,
el tile «Bebida» abre este mismo registro vía `IntolHome.registerTile`.

## Estructura

```text
index.html          UI + pestañas (Registrar · Timeline · Dieta · Resumen · Ajustes)
styles.css          estilos mobile-first, tema claro/oscuro automático, sin dependencias
js/data.js          ventanas de onset, síntomas, keywords
js/store.js         localStorage + IndexedDB + compresión de fotos
js/providers.js     abstracción BYOK vía proxy /api/analyze (Claude y Groq reales, resto stubs)
js/diet.js          dieta de prueba: señales, plan local, conflictos, comparación, lista de la compra (sin DOM)
js/diary.js         diario: síntomas del texto, ventana 24 h, análisis local, migración, recordatorio (sin DOM)
js/features/bowel.js     deposiciones: Bristol, señales para diario/dieta (sin DOM)
js/features/bowel-ui.js  deposiciones: hoja de registro, tarjeta de timeline, reparto del Resumen
js/features/drinks.js bebidas: catálogo con componentes, hidratación, enganche al tile Bebida (sin DOM)
js/features/mood-sleep.js  ánimo y sueño: registros, tendencia semanal, contexto para diario y dieta (sin DOM)
js/app.js           UI, diario, bebidas, deposiciones, ánimo, recordatorio, timeline, dieta, resumen
sw.js               service worker solo para notificaciones (sin caché)
functions/api/analyze.js  proxy BYOK anti-CORS en Pages Functions (la key solo transita)
functions/api/diet.js     proxy BYOK hermano para la dieta de prueba (misma taxonomía de errores)
functions/api/diary.js    proxy BYOK del diario: posibles causas en las comidas de las 24 h anteriores
tests/*.test.mjs          pruebas sin dependencias: node tests/diet.test.mjs (ídem diary, bowel, claude-thinking)
docs/cloudflare.md  despliegue Pages + proxy BYOK
docs/verificacion.md  plan de verificación manual
```

## Privacidad

- Proxy same-origin `/api/analyze`, `/api/diet` y `/api/diary` (Pages Functions): el navegador nunca llama directo
  al proveedor (adiós CORS); la clave BYOK viaja solo en la petición, sin guardarse ni loguearse.
- Las claves nunca se commitean: `git grep -i "sk-ant"` debe devolver vacío siempre.
