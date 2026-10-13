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

## 5. IA con Claude BYOK (2 min, opcional con clave)

- [ ] Pestaña **⚙️ Ajustes**: pega tu `sk-ant-…` → **Guardar claves** → **Probar conexión** → ✔ responde.
- [ ] En Registrar, con foto y/o descripción, pulsa **🤖 Analizar con IA**:
      verás resumen + pregunta de seguimiento con disclaimer no-médico.
- [ ] Guarda la comida: los ingredientes detectados por IA llevan pastilla azul (`src-ia`).
- [ ] DevTools → Sources/Vistas: la clave **solo** está en localStorage (`intol.settings.v1`);
      `git grep -i "sk-ant"` en el repo no devuelve nada.

## 6. Sin clave (1 min)

- [ ] Sin claves, “Analizar con IA” usa el **análisis local** y lo indica explícitamente.
- [ ] Proveedores Hermes/Groq/Cursor muestran “pendiente de implementar” sin romper nada.

## Criterio de aceptación

Todo lo anterior en verde + `docs/verificacion.md` existe + sin claves en el repo
+ la app abre con doble clic en `index.html` (modo degradado file://) además de por servidor local.
