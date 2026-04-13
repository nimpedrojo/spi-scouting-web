# Suite modular migration plan

## Objetivo de esta iteración

Preparar dentro de `spi-scouting-web` una base técnica para evolucionar la aplicación hacia una suite modular por club, sin duplicar el core actual, sin forks y sin reescrituras agresivas.

## 1. Qué constituye hoy el futuro `core`

El análisis del repositorio actual indica que estas piezas pertenecen al futuro `core`, porque resuelven identidad, contexto de club, administración base o estructura transversal:

- `src/app.js`, `src/server.js`, `src/db.js`, `src/initDb.js`
- `src/routes/authRoutes.js`
- `src/routes/userAdminRoutes.js`
- `src/routes/clubAdminRoutes.js`
- `src/routes/clubConfigRoutes.js`
- `src/routes/teamRoutes.js`
- `src/routes/playerAdminRoutes.js`
- `src/middleware/auth.js`
- `src/middleware/requestLogger.js`
- `src/middleware/sessionContext.js`
- `src/models/userModel.js`
- `src/models/clubModel.js`
- `src/models/seasonModel.js`
- `src/models/sectionModel.js`
- `src/models/categoryModel.js`
- `src/models/teamModel.js`
- `src/models/teamPlayerModel.js`
- `src/services/teamService.js`
- `src/services/userScopeService.js`
- `src/services/clubAdminService.js`
- `src/services/logger.js`
- `src/services/auditLogger.js`
- `src/views/auth/*`
- `src/views/clubs/*`
- `src/views/club/*`
- `src/views/users/*`
- `src/views/teams/*`
- `src/views/dashboard/*`
- `src/views/partials/*`

Notas:

- `playerAdminRoutes` y parte del stack de jugadores hoy siguen muy mezclados con scouting, pero operativamente ya cumplen también una función de core porque sostienen la base de jugadores y plantillas.
- `teamRoutes` es claramente estructura de club/base y por eso se mantiene en `core` en esta iteración.

## 2. Qué constituye hoy `scoutingPlayers`

Estas piezas actuales pertenecen funcionalmente al futuro módulo `scoutingPlayers` porque gestionan scouting individual, evaluaciones comparativas o capas analíticas sobre jugadores:

- `src/routes/reportRoutes.js`
- `src/routes/assessmentRoutes.js`
- `src/routes/evaluationRoutes.js`
- `src/routes/playerProfileRoutes.js`
- `src/routes/evaluationTemplateRoutes.js`
- `src/routes/seasonComparisonRoutes.js`
- `src/routes/seasonForecastRoutes.js`
- `src/controllers/assessmentHubController.js`
- `src/controllers/evaluationController.js`
- `src/controllers/playerProfileController.js`
- `src/controllers/seasonComparisonController.js`
- `src/controllers/seasonForecastController.js`
- `src/controllers/evaluationTemplateController.js`
- `src/models/reportModel.js`
- `src/models/evaluationModel.js`
- `src/models/evaluationScoreModel.js`
- `src/models/evaluationTemplateModel.js`
- `src/models/evaluationTemplateMetricModel.js`
- `src/services/evaluationService.js`
- `src/services/evaluationTemplateService.js`
- `src/services/reportComparisonService.js`
- `src/services/playerAnalyticsService.js`
- `src/services/seasonComparisonService.js`
- `src/services/seasonForecastService.js`
- `src/services/pdfReportService.js`
- `src/views/reports/*`
- `src/views/evaluations/*`
- `src/views/evaluation-templates/*`
- `src/views/season-comparison/*`
- `src/views/season-forecast/*`
- `src/views/assessments/*`
- parte de `src/views/players/*` cuando renderiza histórico, perfil o comparativas

Notas:

- No se ha movido este código legacy de golpe. En esta iteración se ha encapsulado su montaje de rutas bajo `src/modules/scoutingPlayers/routes/index.js`.
- El dashboard sigue mostrando los flujos existentes de scouting de jugadores cuando el módulo `scouting_players` está activo.

## 3. Qué debe considerarse `shared`

Las piezas compartidas son utilidades o contratos que no deberían depender de módulos concretos:

- `src/shared/constants/moduleKeys.js`
- `src/shared/services/clubModuleService.js`
- futuros helpers genéricos en `src/shared/utils`, `src/shared/services`, `src/shared/ui`
- layout general y parciales reutilizables
- constantes de navegación, branding, claves de módulo y utilidades de control de acceso

Regla aplicada en esta iteración:

- `shared` no depende de módulos.
- `core` puede depender de `shared`.
- `modules/*` puede depender de `core` y `shared`.

## 4. Estructura creada en esta iteración

Se ha preparado la siguiente base modular sin reubicar todavía el código legacy sensible:

- `src/core/routes/index.js`
- `src/core/models/clubModuleModel.js`
- `src/modules/scoutingPlayers/routes/index.js`
- `src/modules/planning/controllers/planningController.js`
- `src/modules/planning/routes/index.js`
- `src/modules/scoutingTeams/controllers/scoutingTeamsController.js`
- `src/modules/scoutingTeams/routes/index.js`
- `src/middleware/roleMiddleware.js`
- `src/middleware/clubScopeMiddleware.js`
- `src/middleware/moduleMiddleware.js`
- `src/views/modules/planning/index.ejs`
- `src/views/modules/scouting-teams/index.ejs`
- `src/views/errors/module-disabled.ejs`

También se han creado o dejado preparadas las carpetas objetivo:

- `src/core/controllers`
- `src/core/models`
- `src/core/routes`
- `src/core/services`
- `src/core/views`
- `src/modules/scoutingPlayers/*`
- `src/modules/planning/*`
- `src/modules/scoutingTeams/*`
- `src/shared/utils`
- `src/shared/constants`
- `src/shared/services`
- `src/shared/ui`

## 5. Sistema base de módulos por club

Se ha introducido soporte real para módulos activables por club:

- nueva tabla `club_modules`
- claves iniciales:
  - `scouting_players`
  - `planning`
  - `scouting_teams`
- middleware `requireModule(moduleKey)`
- carga del estado de módulos en el contexto de cada request

Estrategia de compatibilidad elegida:

- `scouting_players` se siembra activo por defecto para todos los clubes existentes y nuevos
- `planning` y `scouting_teams` se crean desactivados por defecto
- si un club legacy no tiene filas en `club_modules`, la aplicación las auto-crea al consultar su estado

Esta estrategia es la más segura para no romper la app actual, porque conserva operativo el flujo maduro de scouting de jugadores.

Fallback temporal adicional:

- si un usuario autenticado todavía no tiene club activo en contexto, `scouting_players` sigue disponible para mantener compatibilidad con flujos legacy existentes
- este fallback deberá retirarse cuando toda la navegación dependa siempre de `club_id` y contexto de club resuelto

## 6. Estrategia de migración gradual

La migración propuesta a partir de ahora es:

1. Mantener el montaje central en `app.js`, pero agregando por routers modulares en lugar de montar cada ruta legacy de forma dispersa.
2. Mover primero solo puntos de entrada y contratos compartidos, no controladores complejos.
3. Extraer después servicios y modelos claramente pertenecientes a `scoutingPlayers` a carpetas nuevas, manteniendo wrappers temporales de compatibilidad.
4. Separar en una siguiente iteración la parte de jugadores/plantillas entre `core` y `scoutingPlayers`, porque hoy todavía comparten demasiada lógica operativa.
5. Integrar `planning` y `scoutingTeams` sobre los routers placeholder creados, activando navegación real solo cuando exista una primera funcionalidad estable.

## 7. Riesgos actuales

- `playerAdminRoutes` y varias vistas de jugadores siguen siendo mixtas entre core y scouting.
- `teamService` y `userScopeService` contienen lógica transversal que conviene trocear antes de una separación más profunda.
- algunas consultas legacy siguen acopladas a nombres de club (`default_club`) además de `club_id`.
- ya existe una primera interfaz de administración para activar/desactivar módulos por club, incluyendo presets rápidos, pero todavía puede evolucionar hacia una gestión más rica por perfiles o licencias.
- el dashboard base ya es modular, pero su parte analítica sigue siendo esencialmente `scoutingPlayers`.

## 8. Pasos siguientes para integrar `spi-opponent-scouting-web`

La integración recomendada, sin forks ni doble core, es:

1. Inventariar en `spi-opponent-scouting-web` solo dominios funcionales, no copiar estructura completa.
2. Mapear sus casos de uso al módulo destino `scoutingTeams`.
3. Reutilizar autenticación, usuarios, club, contexto, branding y activación por club desde este repo.
4. Importar primero servicios/modelos autocontenidos de scouting de equipos hacia `src/modules/scoutingTeams`.
5. Adaptar sus rutas y vistas al layout SSR actual con EJS y Bootstrap.
6. Sustituir dependencias cruzadas al repo externo por contratos internos sobre `core` y `shared`.
7. Activar el módulo por club solo cuando el primer vertical funcional esté cubierto end-to-end.

## 9. Estado actual de `scoutingTeams`

En esta iteración ya se ha integrado un MVP funcional dentro de `src/modules/scoutingTeams`.

Qué se ha tomado del repo secundario:

- el concepto de rival persistente
- el informe de scouting como entidad central
- la estructura táctica del contenido

Qué se ha adaptado a propósito:

- el backend TypeScript con múltiples endpoints se ha convertido en un flujo SSR simple y coherente con `spi-scouting-web`
- el editor React por secciones se ha sustituido por una ficha única EJS más segura para esta fase
- el modelo relacional se ha simplificado para evitar arrastrar complejidad prematura
- los permisos se han alineado con el core existente:
  - usuarios crean y editan sus propios informes
  - admins y superadmins gestionan todos los informes del club

Qué no se ha migrado:

- React, Vite, TypeScript, tests frontend y shell de navegación del repo secundario
- auth, usuarios, layouts y configuración base duplicados
