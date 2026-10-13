# Plantilla de PR · Intolerancias

> **Gate de aceptación:** sin toda la evidencia marcada no se pasa el PR de draft a ready ni se pide review (ver `docs/verificacion.md`, sección «Gate de aceptación para PRs»). PR sin checklist completa = draft.

## Issues vinculados

<!-- Obligatorio: lista los issues y marca sus criterios de aceptación abajo. -->
Closes: #<!-- nº -->

## Criterios de aceptación de los issues vinculados

<!-- Copia aquí los criterios de aceptación de cada issue vinculado y márcalos. -->
<!-- Ejemplo: #1 exige docs/verificacion.md en verde + sin claves; #4 exige checklist en Chrome y Firefox. -->
- [ ] Criterio 1 del issue #___: ___
- [ ] Criterio 2 del issue #___: ___
- [ ] Verificación manual completa (`docs/verificacion.md`) en verde, si aplica al cambio

## Evidencia de verificación (según `docs/verificacion.md`)

<!-- Obligatorio en PRs de features. Pega comandos y resultados reales, no «OK» genérico. -->
- [ ] `node --check` en los JS tocados:
  <!-- p. ej. `node --check js/app.js && …` → 4/4 OK -->
  ```
  (pegar comando + salida)
  ```
- [ ] Rutas servidas en local devuelven 200:
  <!-- p. ej. `python3 -m http.server` + curl a /, index.html, styles.css, js/*, docs/verificacion.md -->
  ```
  (pegar rutas + códigos)
  ```
- [ ] Prueba lógica mínima:
  <!-- p. ej. «pizza con queso y cerveza» → lactosa+gluten+alcohol; prioridad Claude > Hermes > Groq > Cursor; stubs sin romper -->
  ```
  (pegar entrada + salida observada)
  ```
- [ ] Sin claves ni datos personales en el repo:
  <!-- `git grep -iE "sk-ant-[A-Za-z0-9_-]{10,}"` vacío (los placeholders `sk-ant-…` en docs/UI no cuentan) -->
  ```
  (pegar comando + salida)
  ```

## Cómo probado en local

<!-- Obligatorio: comando exacto de arranque + navegador + pasos. -->
```bash
(pegar comando, p. ej. python3 -m http.server 8080)
```
- Navegador(es): ___
- Pasos: ___

## Capturas / logs (si aplica)

<!-- UI → capturas; errores/degradados (CORS, file://, sin clave) → logs. Si no aplica, escribe «No aplica porque…». -->
- ___

## Sin claves

- [ ] Confirmo que no commiteo claves ni datos personales; las claves BYOK solo viven en el localStorage del navegador.
