# 🌿 Intolerancias

Diario personal de comidas y bienestar. **100% frontend, sin backend, sin cuentas, sin perfiles.**
Todo vive en tu navegador: `localStorage` (comidas, check-ins, ajustes) + `IndexedDB` (fotos).

Registras qué comes (foto y/o texto) y cómo te sienta; la app —con IA opcional (BYOK)—
te hace seguimiento con check-ins de *“¿cómo te sientes?”* en las ventanas típicas de
aparición por ingrediente, y te sugiere descartes (*“prueba a no comer X”*).

> ⚠️ **App orientativa, no médica.** Las ventanas por ingrediente (gluten, lactosa, etc.)
> son orientativas y no diagnostican nada. Ante síntomas persistentes, pide una
> **prueba médica real** con un profesional sanitario.

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
proveedor basta implementar `ping` + `analyzeFood` en `js/providers.js`, sin refactorizar.

## Estructura

```text
index.html          UI + pestañas (Registrar · Timeline · Resumen · Ajustes)
styles.css          estilos mobile-first, tema claro/oscuro automático, sin dependencias
js/data.js          ventanas de onset, síntomas, keywords, disclaimer
js/store.js         localStorage + IndexedDB + compresión de fotos
js/providers.js     abstracción BYOK (Claude y Groq reales, resto stubs)
js/app.js           UI, recordatorios, timeline, resumen
docs/verificacion.md  plan de verificación manual
```

## Privacidad

- Sin backend: la única salida de red es la llamada directa al proveedor de IA **que tú elijas**.
- Las claves nunca se commitean: `git grep -i "sk-ant"` debe devolver vacío siempre.
