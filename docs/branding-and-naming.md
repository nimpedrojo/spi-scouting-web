# Branding and naming

Naming oficial
- Producto: SoccerProcessIQ Suite
- Subtítulo: Modular Football Club Platform

Naming de módulos (clave técnica vs etiqueta)
- Claves técnicas (valores usados en código):
  - `scouting_players` — etiqueta: "Scouting Players"
  - `scouting_teams` — etiqueta: "Scouting Teams"
  - `planning` — etiqueta: "Planning"

Reglas de uso
- En el código y en la persistencia siempre usar las claves técnicas (`MODULE_KEYS` en `src/shared/constants/moduleKeys.js`).
- Las etiquetas y descripciones destinadas a interfaces o documentación legible por usuarios deben obtenerse de `CLUB_MODULE_META` en `src/shared/services/clubModuleService.js` para asegurar consistencia.
- No cambiar claves técnicas existentes: rompería migraciones y datos en la tabla `club_modules`.

Transición desde "SoccerReport"
- Contexto: la UI y las rutas históricas conservan nombres y paths (por compatibilidad), pero la documentación y los assets pueden migrar gradualmente al naming de suite.
- Recomendación de migración mínima:
  - Mantener rutas internas estables (evitar renombrar endpoints existentes).
  - Actualizar las cabeceras y el branding visible en vistas (layout) en un paso separado y revisado, asegurando que `res.locals.pageTitle` y `res.locals.activeClubBranding` se respetan.
  - Documentar en `docs/` cualquier cambio visible para los usuarios; este repositorio ya incluye `layout` y vistas en `src/views` donde el branding se puede actualizar sin refactorizar la lógica.

Ejemplo de uso (técnico)
- Para mostrar módulos activos en una vista EJS: iterar `res.locals.activeModules` (introducido por `attachModuleContext`) y usar `CLUB_MODULE_META` para etiquetas.
