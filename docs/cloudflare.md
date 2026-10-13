# Despliegue en Cloudflare · Intolerancias

> Estado: **todo listo para desplegar, despliegue real pendiente de confirmación.**
> No se ha publicado nada ni se ha pedido ninguna credencial.
> Bloqueadores y checklist de ejecución: issue de despliegue (ver §5).

## 0. Decisión: Cloudflare Pages (no Worker)

Se elige **Cloudflare Pages** en lugar de un Worker con `wrangler.toml`:

| Criterio | Pages | Worker con assets |
|---|---|---|
| App 100% estática, sin build, sin backend | ✅ `wrangler pages deploy .` directo | ✅ pero exige código JS + `wrangler.toml` |
| Previews automáticas por rama/PR | ✅ gratis, por defecto | ❌ hay que montarlas a mano |
| Cabeceras/caché | ✅ fichero `_headers` | hay que programarlas |
| Secretos en servidor | ninguno (BYOK vive en el navegador) | ninguno, pero el Worker añade superficie |
| Mantenimiento | nulo | un fichero JS + config que mantener |

**Conclusión:** un Worker no aporta nada a un MVP sin backend; solo añade
código y config. Por eso **no hay `wrangler.toml` ni `worker.js`** en el repo:
Pages no los necesita y el despliegue se configura con los scripts de
`package.json` + el proyecto Pages en el dashboard.
La app sigue abriendo con doble clic en `index.html` y con `npm run serve`.

## 1. Qué hay en el repo para desplegar

- `package.json` — scripts:
  - `npm run serve` → servidor local sin dependencias (`python3 -m http.server 8080`).
  - `npm run preview` → `wrangler pages dev .` (emula Pages en local).
  - `npm run deploy` → publica **producción** (rama `main` del proyecto `intolerancias`).
  - `npm run deploy:preview` → publica **preview** de la rama actual.
- `_headers` — cabeceras de seguridad + caché de `styles.css`/`js/*`.
  Inerte en local; solo lo aplica Pages. Si se añade un proveedor IA nuevo
  (Groq/Hermes/Cursor), hay que ampliar `connect-src` en la CSP de este fichero.

## 2. Primera vez: crear el proyecto (2 minutos, manual)

1. Entrar en [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages
   → Create → Pages → Upload assets** (o **Connect to Git**, ver §4).
2. Nombre del proyecto: `intolerancias`.
3. Subir la raíz del repo (o conectar el repo y poner **Build command vacío** y
   **Build output directory** = `.` — no hay build).
4. Resultado: URL de producción `https://intolerancias.pages.dev`
   y previews `https://<rama>.intolerancias.pages.dev`.

## 3. Secretos necesarios

**La app no necesita ningún secreto para funcionar**: las claves de IA son BYOK
y viven solo en el `localStorage` del navegador (§5 de `docs/verificacion.md`).

| Secreto | Dónde | Obligatorio |
|---|---|---|
| Ninguno para la app en sí | — | No |
| `CLOUDFLARE_API_TOKEN` | Solo si se automatiza el deploy desde GitHub Actions (token con permiso **Pages:Edit** en la cuenta) | Solo CI |
| `CLOUDFLARE_ACCOUNT_ID` | Idem, como variable del repo | Solo CI |

Sin CI, basta con hacer login local una vez (`npx wrangler login`) y usar
`npm run deploy`. **No commitear tokens**: van en variables de entorno o en
GitHub → Settings → Secrets.

## 4. Publicar cada feature: preview vs prod

**Vía recomendada (Git connect):** al conectar el repo, cada push a cualquier
rama genera una **preview** con URL propia, y cada merge a `main` actualiza
**producción**. Flujo por feature:

1. Rama `cursor/mi-feature-*` → push → QA en `https://<rama>.intolerancias.pages.dev`.
2. PR draft → main con evidencia (gate de aceptación: checklist + capturas).
3. Merge → producción en `https://intolerancias.pages.dev`.

**Vía CLI (sin Git connect):**

```bash
npm install            # instala wrangler (devDependency)
npx wrangler login     # una sola vez, abre el navegador
npm run deploy:preview # preview de la rama actual
npm run deploy         # producción (solo desde main)
```

Nunca publicar producción desde una rama de feature con el CLI.

## 5. Issue de despliegue

Checklist de ejecución, bloqueadores (cuenta, zona, dominio) y decisión de
dominio custom: ver el issue **“[Deploy] Publicar MVP en Cloudflare Pages”**
en GitHub. Sin resolver esos bloqueadores no hay despliegue real.
