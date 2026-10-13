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

## 1. Registrar comida (2 min)

- [ ] Pestaña **＋ Registrar**: escribe “pizza con queso y cerveza”, marca 3/5 y pulsa **Guardar comida**.
- [ ] Aparece en **Timeline** con pastillas `Lactosa` y `Gluten` (análisis local por palabras clave).
- [ ] En **Próximos check-ins** hay avisos programados (2 h, 6 h, 24 h + ventanas de ingrediente).
- [ ] Recarga la página: la comida **persiste** (localStorage).

## 2. Foto comprimida (1 min)

- [ ] Registra otra comida con foto (móvil o archivo). Se ve miniatura en el timeline.
- [ ] DevTools → Application → IndexedDB → `intol-photos`: hay una entrada (foto completa).
- [ ] DevTools → Application → Local Storage: solo hay miniatura (`thumb`), no la foto completa.

## 3. Check-ins y notificaciones (2 min)

- [ ] Pulsa **🔔 Activar notificaciones** y acepta el permiso.
- [ ] Pulsa **Responder** en un check-in pendiente: elige 2/5 + síntoma “hinchazón” → Guardar.
- [ ] El timeline muestra `✔ … → 2/5 hinchazón` bajo la comida.
- [ ] **Posponer 30 min** mueve el aviso (visible en Próximos check-ins).

## 4. Resumen y descarte (2 min)

- [ ] Registra ≥2 comidas con lactosa y responde sus check-ins con 1–2/5.
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
      que programa check-ins). Campos aditivos: clientes sin ellos siguen funcionando.
      Cubierto por el arnés 2 (casos 9–12).
- [ ] **Sin clave ni proxy**: en `file://` o `python -m http.server`, Analizar usa el
      **análisis local** y el error es `network` (“sin proxy”), nunca CORS.
- [ ] **Automático (sin navegador)**: `node --check functions/api/analyze.js` OK +
      prueba de validación/privacidad del proxy (ver evidencia del PR: GET salud,
      401 sin key, 501 hermes, 400 proveedor, y `grep` de que la Function no
      loguea ni devuelve la key).
- [ ] **Prod intacta**: `https://intolerancias.pages.dev/` sigue en 200 y este cambio
      solo **añade** `/api/analyze` sin tocar `/`, `js/*` ni docs existentes.

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
