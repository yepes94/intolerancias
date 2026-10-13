# Despliegue en Cloudflare · Intolerancias

> App estática en **Cloudflare Pages** + mini-proxy BYOK en **Pages Functions**
> (`POST /api/analyze`). Sin secretos en servidor, sin P-Stack (sin KV/D1/colas).

## 0. Decisión: Pages + Functions (sin Worker aparte)

| Criterio | Pages (+ Functions para `/api/*`) | Worker con assets |
|---|---|---|
| App estática, sin build | ✅ se sirve la raíz tal cual | ✅ pero exige `wrangler.toml` |
| Previews por rama/PR | ✅ gratis, por defecto | ❌ a mano |
| Proxy same-origin anti-CORS | ✅ `functions/api/analyze.js` se despliega solo | hay que programar rutas |
| Secretos en servidor | ninguno (BYOK en tránsito, §2) | ninguno, pero más superficie |

**Conclusión:** todo el backend es un único fichero `functions/api/analyze.js`.
No hay `wrangler.toml`: el proyecto Pages se configura en el dashboard
(Build command vacío, output `.`).

## 1. Qué hay en el repo

```text
functions/api/analyze.js  proxy BYOK: recibe { provider, action, key, … },
                          reenvía a Claude/Groq y devuelve JSON limpio
                          (GET = salud de la ruta, sin clave)
index.html · styles.css · js/*   frontend estático (llama a /api/analyze, nunca
                          directo a api.anthropic.com/api.groq.com)
docs/verificacion.md      plan de verificación manual (§8 = proxy)
```

## 2. Cómo viaja la clave BYOK (privacidad)

1. La clave vive **solo en el localStorage** del navegador (Ajustes).
2. Al pulsar **Analizar con IA** / **Probar conexión**, el frontend hace
   `POST /api/analyze` (mismo origen: **cero CORS**) con
   `{ provider, action, key, model, description, imageDataUrl }`.
3. La Function usa `key` solo para firmar la llamada al proveedor y responde
   `{ ok: true, result }` o `{ ok: false, kind, message }` (taxonomía
   `auth/network/badjson/ratelimit/badrequest/server/notimpl`, la misma que la UI).
4. La clave **nunca se guarda** (sin KV/D1/env), **nunca se loguea**
   (el código no hace `console.log` del body ni de la key) y **nunca vuelve**
   en la respuesta. Todas las respuestas llevan `Cache-Control: no-store`.

Sin clave, el frontend usa el **análisis local por palabras clave** (offline).

## 3. Probar el proxy en local

`python3 -m http.server` sirve el estático pero **no** ejecuta Functions.
Para el proxy en local hace falta wrangler (devDependency pendiente del
PR de deploy; si no está, `npx -y wrangler pages dev .` lo descarga):

```bash
npx -y wrangler pages dev . --port 8788
curl -s http://localhost:8788/api/analyze          # → {"ok":true,"service":"analyze-proxy",…}
curl -s -X POST http://localhost:8788/api/analyze \
  -H 'content-type: application/json' \
  -d '{"provider":"claude","action":"ping","key":"sk-ant-falsa"}'  # → ok:false, kind auth
```

Sin wrangler: la app sigue abriendo con doble clic / `python3 -m http.server`,
pero `/api/analyze` no existe y la UI cae al análisis local (mensaje `network`).

## 4. Preview y producción

- **Preview por rama:** cada push a `cursor/*` genera
  `https://<rama>.intolerancias.pages.dev`. Probar allí `GET /api/analyze`
  (200 salud) y un `ping` con clave falsa (401 `auth`, nunca la real en la
  evidencia) antes de pedir review.
- **Producción** `https://intolerancias.pages.dev/` solo se toca por merge a
  `main`. Este cambio no altera ninguna ruta existente (`/`, `js/*`, docs):
  solo **añade** `/api/analyze`, así que prod no se rompe.
- Si el proyecto Pages aún no existe: dashboard → Workers & Pages → Create →
  Pages → Connect to Git, proyecto `intolerancias`, Build vacío, output `.`.

## 5. Secretos necesarios

Ninguno para la app (BYOK en tránsito, §2). Solo CI si se automatiza:
`CLOUDFLARE_API_TOKEN` (permiso Pages:Edit) + `CLOUDFLARE_ACCOUNT_ID`.
**No commitear tokens.**
