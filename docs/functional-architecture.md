# Functional architecture

Responsabilidades del Core (SPI Core)
- Autenticación y sesión (`src/middleware/sessionContext.js`).
- Gestión de clubes, usuarios y permisos (`src/core/models`, `src/core/controllers`).
- Servicios compartidos y utilidades (`src/shared/services`, `src/shared/constants`).
- Provisión de contexto por petición (club activo, temporada, branding) y resolución de módulos activos (`src/middleware/moduleMiddleware.js`).

Responsabilidades de los módulos
- `scouting_players` (módulo histórico): gestión de informes individuales, modelos de datos de evaluación, exportación y APIs para integraciones. Rutas en `src/modules/scoutingPlayers/routes`.
- `scouting_teams`: pantalla y API para scouting de equipos rivales; rutas en `src/modules/scoutingTeams/routes`.
- `planning`: flujos de planificación deportiva, rutas en `src/modules/planning/routes`.

Relación entre Club / Equipo / Jugador / Módulos
- El Core mantiene las entidades definitivas de `clubs`, `users` y `club_teams`.
- Los módulos consumen el contexto del club activo (determinación vía sesión o contexto de petición). Cuando no hay club activo, se usan presets por defecto para usuarios autenticados.
- La activación de módulos se gestiona por club (tabla `club_modules`) y condiciona el acceso a rutas/funcionalidades mediante `requireModule` y `attachModuleContext` en `src/middleware/moduleMiddleware.js`.

Activación de módulos (resumen técnico)
- Los módulos y su estado por club se almacenan en la tabla `club_modules` gestionada por `src/core/models/clubModuleModel.js`.
- El servicio `src/shared/services/clubModuleService.js` define metadatos, presets y operaciones para leer/actualizar el estado por club.
- El middleware `requireModule(moduleKey)` impide el acceso a rutas cuando el módulo está deshabilitado y devuelve páginas JSON o vistas de error según el `Accept` de la petición.
