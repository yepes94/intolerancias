# Verificación manual · Intolerancias (MVP)

> Objetivo: comprobar en ~10 minutos que el MVP funciona 100% en local,
> sin backend y sin exponer claves. Todo es frontend estático.

## 0. Arranque local (elegir una vía)

```bash
# Vía A — Python (sin dependencias)
python3 -m http.server 8080
# Vía B — Node
npx serve .
```

Abrir http://localhost:8080 en Chrome/Edge/Firefox.

## 0. Navegación (1 min)

- [ ] **Móvil 375px / 390px**: barra inferior fija con icono + etiqueta; ninguna etiqueta se
      parte ni se corta, cada pestaña mide ≥44px de alto y la barra respeta el área segura
      inferior (iPhone). La activa se ve en color de marca, negrita y con fondo tras el icono.
- [ ] **Desktop (≥768px)**: control segmentado en la cabecera sticky, activa con borde de marca.
- [ ] Teclado: `Tab` muestra foco visible en cada pestaña; la activa lleva `aria-current="page"`.
- [ ] El final de página (pie) y el toast no quedan tapados por la barra.

## 1. Registrar comida (2 min)

- [ ] Pestaña **✍️ Registrar**: escribe “pizza con queso y cerveza”, marca 3/5 y pulsa **Guardar comida**.
- [ ] Aparece en **Timeline** con pastillas `Lactosa` y `Gluten` (análisis local por palabras clave).
- [ ] Guardar la comida **no programa avisos** (ya no hay «Próximos check-ins» ni badge).
- [ ] Recarga la página: la comida **persiste** (localStorage).

## 2. Foto comprimida (1 min)

- [ ] Registra otra comida con foto (móvil o archivo). Se ve miniatura en el timeline.
- [ ] DevTools → Application → IndexedDB → `intol-photos`: hay una entrada (foto completa).
- [ ] DevTools → Application → Local Storage: solo hay miniatura (`thumb`), no la foto completa.

## 3. Diario de síntomas (2 min) — detalle en §10

- [ ] Botón flotante **📝 ¿Cómo te sientes?** (en cualquier pestaña) → escribe
      “tripa hinchada y gases”, nivel 2 → **Guardar y buscar causas**.
- [ ] El timeline muestra la entrada 📝 con `hinchazón`, `gases` y las posibles causas
      (la pizza del paso 1, con probabilidad y motivo); bajo la comida aparece `📝 … → 2/5`.

## 4. Resumen y descarte (2 min)

- [ ] Registra ≥2 comidas con lactosa y escribe en el diario, después de cada una, que te sentó mal (o nivel 1–2).
- [ ] Pestaña **📊 Resumen**: `Lactosa` sale en “Sienta mal” y aparece la tarjeta
      “🧪 Prueba a no comer lactosa…”.
- [ ] **Exportar datos** descarga un JSON; **Borrar todo** limpia localStorage + IndexedDB.

## 5. IA con Claude o Groq BYOK (2 min, opcional con clave)

- [ ] Pestaña **⚙️ Ajustes**: pega tu `sk-ant-…` (Claude) o tu `gsk-…` gratis de
  <https://console.groq.com/keys> → **Guardar claves** → **Probar conexión** → ✔ responde.
- [ ] En Registrar, con foto y/o descripción, pulsa **🤖 Analizar con IA**:
      verás resumen + pregunta de seguimiento con disclaimer no-médico.
- [ ] Guarda la comida: los ingredientes detectados por IA llevan pastilla azul (`src-ia`).
- [ ] DevTools → Sources/Vistas: la clave **solo** está en localStorage (`intol.settings.v1`);
      `git grep -i "sk-ant"` en el repo no devuelve nada.

## 6. Sin clave (1 min)

- [ ] Sin claves, “Analizar con IA” usa el **análisis local** y lo indica explícitamente.
- [ ] Proveedores Hermes/Cursor muestran “pendiente de implementar” sin romper nada.

## 7. IA: errores accionables y JSON robusto (3 min, sin clave real)

> El botón **🤖 Analizar con IA** ya no muestra el genérico
> “La IA no devolvió un JSON reconocible. Revisa tu clave…”.
> Ahora distingue la causa y propone una acción; el análisis local
> siempre aparece como fallback en la misma caja.

- [ ] **Clave inválida**: en Ajustes pega `sk-ant-falsa` → **Probar conexión** →
      mensaje de *clave rechazada* con acción “borra la clave y pégala de nuevo completa”.
- [ ] **Sin red / sin proxy**: sirve por `file://` o corta la red → **Analizar con IA** →
      mensaje de *sin red o sin proxy /api/analyze* (menciona Pages/wrangler), no culpa a la clave.
- [ ] **Respuesta rara del modelo**: si la IA responde prosa sin JSON o vacío →
      mensaje de *formato inesperado* con acción “pulsa de nuevo Analizar con IA”
      (reintentar), más el análisis local debajo.
- [ ] **Fallback local**: en cada error la caja muestra además el
      **análisis local por palabras clave** y deja sus ingredientes listos para guardar
      (p. ej. “pizza con queso y cerveza” → `lactosa` + `gluten` + `alcohol`).
- [ ] **Automático (sin navegador)**: `node /tmp/repro-ia.js` (8 casos de formato:
      JSON limpio, fences markdown, prosa alrededor, comillas simples, comas finales,
      prosa sin JSON, vacío, doble objeto) y `node /tmp/repro-errores.js`
      (17 aserciones: 401/429/500, TypeError de red, formato de clave Groq,
      prioridad Claude > Hermes > Groq > Cursor, fallback local, sin exfiltración)
      cargando los `js/` reales del repo.

## 8. Proxy /api/analyze anti-CORS (3 min, con preview o wrangler local)

> El navegador **ya no llama directo** a `api.anthropic.com` / `api.groq.com`
> (adiós CORS y `anthropic-dangerous-direct-browser-access`): todo pasa por
> `POST /api/analyze` (mismo origen). La clave BYOK viaja solo en la petición.

- [ ] **Salud de la ruta**: `GET /api/analyze` → 200
      `{"ok":true,"service":"analyze-proxy","providers":["claude","groq"]}`
      (en preview `https://<rama>.intolerancias.pages.dev/api/analyze` o en local con
      `npx -y wrangler pages dev . --port 8788`).
- [ ] **Clave falsa, sin exponer real**: `POST /api/analyze`
      `{"provider":"claude","action":"ping","key":"sk-ant-falsa"}` → `ok:false`,
      `kind:"auth"` (401/403 del proveedor). Repetir con
      `{"provider":"groq","action":"ping","key":"gsk_falsa"}` → `kind:"auth"`.
- [ ] **Validación sin red externa**: `POST` sin `key` → 401 `auth`;
      `provider:"hermes"` → 501 `notimpl`; `provider:"xxx"` → 400.
      (No tocan al proveedor: verificables sin clave y sin internet del proveedor.)
- [ ] **Extremo a extremo con BYOK real** (opcional): en la preview, Ajustes →
      pega tu clave → **Probar conexión** → ✔, y **Analizar con IA** con
      “pizza con queso y cerveza” → resumen + `lactosa/gluten/alcohol`.
      DevTools → Network: la única salida es a `/api/analyze` (mismo origen);
      ni rastro de `api.anthropic.com` en `connect-src`/peticiones.
- [ ] **Respuesta vacía con diagnóstico**: si el proveedor devuelve 200 sin texto
      aprovechable, el error ya no es genérico: incluye `stop=`/`finish=`, tipos de
      bloque y uso (p. ej. `respuesta vacía (stop=end_turn, bloques=[ninguno], uso=…)`),
      y si se cortó por límite lo dice (`max_tokens`/`length`). Foto rota o gigante
      (>4,5 MB) → 400 claro sin llamar al proveedor. Cubierto por `node /tmp/test-analyze2.mjs`
      (8 casos con upstream simulado).
- [ ] **Prompt conciso + alimento detectado**: el prompt pide respuesta corta
      (<250 palabras, `summary` ≤280 caracteres, `components` máx. 6) para que quepa
      holgada en `max_tokens: 1000`. El JSON trae además `food` (alimento detectado,
      ej. "pan blanco de molde") y `components` (ej. gluten, trigo, fructanos, soja,
      posible lactosa); `ingredients` sigue siendo solo claves de taxonomía (lo único
      que se guarda como pastilla de ingrediente). Campos aditivos: clientes sin ellos siguen funcionando.
      Cubierto por el arnés 2 (casos 9–12).
- [ ] **El análisis no se pierde**: tras **Analizar con IA**, guarda la comida →
      el timeline muestra el bloque 🤖 (proveedor + alimento + componentes + resumen)
      junto a tu descripción (que no se toca). Recarga: sigue ahí (va en la entrada,
      en localStorage). **✏️ Análisis** lo edita (alimento/componentes/resumen),
      **Quitar IA** lo borra sin tocar tu texto. Cubierto por `node /tmp/test-analysis-persist.mjs`
      (4 casos: persiste tras recarga, descripción intacta, retrocompat, export).
- [ ] **Sin clave ni proxy**: en `file://` o `python -m http.server`, Analizar usa el
      **análisis local** y el error es `network` (“sin proxy”), nunca CORS.
- [ ] **Automático (sin navegador)**: `node --check functions/api/analyze.js` OK +
      prueba de validación/privacidad del proxy (ver evidencia del PR: GET salud,
      401 sin key, 501 hermes, 400 proveedor, y `grep` de que la Function no
      loguea ni devuelve la key).
- [ ] **Prod intacta**: `https://intolerancias.pages.dev/` sigue en 200 y este cambio
      solo **añade** `/api/analyze` sin tocar `/`, `js/*` ni docs existentes.

## 9. Dieta de prueba con IA (4 min, sin clave real)

- [ ] **Automático**: `node tests/diet.test.mjs` → todo OK (señales, plan local, conflictos,
      comparación, `/api/diet` con upstream simulado, `planDiet` del cliente).
- [ ] **Salud**: `GET /api/diet` → 200 `{"ok":true,"service":"diet-proxy",…}` (preview o
      `npx -y wrangler pages dev . --port 8788`). Con clave falsa
      (`{"provider":"claude","key":"sk-ant-falsa","scope":"day"}`) → `kind:"auth"`.
- [ ] **Sin señales**: datos vacíos → pestaña **🥗 Dieta** dice “dieta equilibrada y ligera”.
- [ ] **Con señales**: registra ≥2 comidas con gluten y escribe en el diario (en las 24 h
      siguientes) hinchazón/pesadez/cansancio (o ≤2/5), y alguna sin gluten con 4–5/5 → “Se excluirá: Gluten”.
- [ ] **Pedir dieta** sin clave → plan local que respeta la exclusión; con clave → plan IA.
      Elige *Día completo* (4 franjas) o *Una comida* (la elegida). Si un plato menciona
      un componente excluido aparece “⚠️ Revisa: puede contener …”.
- [ ] **Plan explicado**: en un día completo aparece «Tu día de un vistazo» (hora, franja,
      plato; pulsar una fila lleva a esa comida). Cada comida muestra hora, ingredientes con
      cantidades, «Cómo prepararlo» (desplegable con pasos), 💡 Por qué, 🔁 Alternativa y
      👀 Qué observar después. Debajo: Consejos, 🛒 Lista de la compra (ingredientes
      agrupados y cantidades sumadas) y «Compartir plan» (hoja de compartir del móvil o
      copia al portapapeles, con el aviso al final). Un plan guardado antes de este cambio
      se sigue viendo, sin los bloques que no tiene.
- [ ] **Seguir y comparar**: «Comí esto» crea la comida (🥗 en el timeline);
      «Registrar cómo me siento» abre el diario “Siguiendo: …”. El plan
      muestra *Con el plan* vs *Sin plan* (nivel medio, % con pesadez/hinchazón/cansancio, síntomas).
- [ ] **Persistencia**: recarga → los planes siguen en “Tus planes” (`intol.diets.v1`);
      entran en *Exportar datos* y *Borrar todo* los elimina.
- [ ] **Disclaimer** visible en la pestaña y en cada plan (médico, nutricionista, pruebas de intolerancia).
- [ ] **Móvil 375px**: sin scroll horizontal en la pestaña Dieta ni en las tarjetas del plan.
- [ ] **Thinking de Claude (familia 5)**: `node tests/claude-thinking.test.mjs` → todo OK
      (respuesta `thinking`+`text` → solo se lee `text`; Sonnet 5.5 → `between_tools`,
      Sonnet 5/Haiku 5.5/Opus 5 → `disabled`, Opus 5.5/Fable → solo `effort: "low"`,
      4.x sin tocar). La dieta no tiene tope propio de tokens: Claude recibe el máximo
      de salida del modelo (128000 en la familia 5 y Opus 4.6+, 64000 en el resto) y, si lo
      rechaza, se reintenta con el máximo que indique el error; si da 429 por tokens de
      salida por minuto (cuentas de tier bajo), un reintento con 16000; Groq va sin `max_tokens`
      y solo si responde 413/429 por cuota TPM se reintenta con 8192. El análisis sigue
      en 2500. Con BYOK real en la
      preview: Ajustes → modelo `claude-sonnet-5-5` (u Opus 5.5) → **Pedir dieta** *Día completo*
      → 4 comidas, sin «Se cortó por límite». Si aun así se corta, el error dice
      «el razonamiento interno del modelo agotó el límite».

## 10. Diario de síntomas y recordatorio de las 21:00 (5 min, sin clave real)

- [ ] **Automático**: `node tests/diary.test.mjs` → todo OK (síntomas del texto, ventana de 24 h,
      análisis local, migración de check-ins, recordatorio, `/api/diary` con upstream simulado,
      `analyzeDiary` del cliente, store).
- [ ] **Salud**: `GET /api/diary` → 200 `{"ok":true,"service":"diary-proxy",…}`. Con clave falsa
      (`{"provider":"claude","key":"sk-ant-falsa","entry":{"text":"tripa hinchada"},"meals":[]}`) → `kind:"auth"`.
- [ ] **Sin clave**: al guardar, la entrada muestra «🔎 Análisis local (sin IA) · posibles causas»
      (componentes de las comidas de las 24 h × ventana típica × síntomas que cuentas).
- [ ] **Con clave**: «🤖 Claude/Groq · posibles causas». DevTools → Network: la única salida es
      `POST /api/diary` con el texto y las comidas resumidas (sin `data:image`, sin ids internos).
      Si la IA falla, se ve el análisis local con «La IA no respondió: …». **🔄 Reanalizar** repite.
- [ ] **Entrada positiva** (nivel 4–5 sin molestias): se guarda sin buscar causas.
- [ ] **Señal de alarma** (“me cuesta respirar”, “sangre”…): aviso 🚑 de atención médica.
- [ ] **Recordatorio**: con una comida hoy y el diario vacío, a la hora de Ajustes (21:00 por
      defecto) aparece el banner en la app y, con permiso, un aviso del sistema (app abierta o en
      segundo plano). **Probar aviso** en Ajustes lo muestra al momento. Escribir una entrada lo
      quita; «Ahora no» lo descarta ese día. Al abrir al día siguiente sin haber escrito: «Ayer
      registraste… ¿Lo apuntas ahora?» y la hora propuesta es ayer a las 21:00.
- [ ] **App cerrada**: no llega aviso (no hay servidor de push); al abrirla se ve el pendiente.
      En iPhone, las notificaciones solo existen con la app añadida a la pantalla de inicio.
- [ ] **Migración**: con check-ins respondidos del sistema anterior (`intol.checkins.v1`), al abrir
      aparecen como «Check-in (histórico)» con su nivel, síntomas, nota y comida; los pendientes no.
      La clave antigua no se borra; **Exportar** incluye `diary` y `checkinsLegacy`.
- [ ] **Móvil 375px**: sin scroll horizontal en el sheet del diario ni en el timeline.

## Criterio de aceptación

Todo lo anterior en verde + `docs/verificacion.md` existe + sin claves en el repo
+ la app abre con doble clic en `index.html` (modo degradado file://) además de por servidor local.

## Gate de aceptación para PRs

Sin toda la evidencia marcada en la descripción del PR (plantilla
`.github/pull_request_template.md`) **no se pasa el PR de draft a ready ni se pide
review**. El autor debe dejar marcada la checklist —criterios de aceptación de los
issues vinculados, evidencia de verificación (`node --check`, rutas 200, prueba
lógica, `grep` sin claves), cómo se probó en local y capturas/logs si aplica—
antes de solicitar revisión. PR sin evidencia completa = draft.
