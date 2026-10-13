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

## Estructura

```text
index.html          UI + pestañas (Registrar · Timeline · Dieta · Resumen · Ajustes)
styles.css          estilos mobile-first, tema claro/oscuro automático, sin dependencias
js/data.js          ventanas de onset, síntomas, keywords
js/store.js         localStorage + IndexedDB + compresión de fotos
js/providers.js     abstracción BYOK vía proxy /api/analyze (Claude y Groq reales, resto stubs)
js/diet.js          dieta de prueba: señales, plan local, conflictos, comparación, lista de la compra (sin DOM)
js/diary.js         diario: síntomas del texto, ventana 24 h, análisis local, migración, recordatorio (sin DOM)
js/app.js           UI, diario, recordatorio, timeline, dieta, resumen
sw.js               service worker solo para notificaciones (sin caché)
functions/api/analyze.js  proxy BYOK anti-CORS en Pages Functions (la key solo transita)
functions/api/diet.js     proxy BYOK hermano para la dieta de prueba (misma taxonomía de errores)
functions/api/diary.js    proxy BYOK del diario: posibles causas en las comidas de las 24 h anteriores
tests/*.test.mjs          pruebas sin dependencias: node tests/diet.test.mjs (ídem diary, claude-thinking)
docs/cloudflare.md  despliegue Pages + proxy BYOK
docs/verificacion.md  plan de verificación manual
```

## Privacidad

- Proxy same-origin `/api/analyze`, `/api/diet` y `/api/diary` (Pages Functions): el navegador nunca llama directo
  al proveedor (adiós CORS); la clave BYOK viaja solo en la petición, sin guardarse ni loguearse.
- Las claves nunca se commitean: `git grep -i "sk-ant"` debe devolver vacío siempre.
