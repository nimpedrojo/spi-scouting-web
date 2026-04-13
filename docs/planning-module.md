# SPI Planning module

## Objetivo del MVP

Convertir `SPI Planning` en un módulo operativo y contextual al equipo dentro de `SoccerProcessIQ Suite`, reutilizando la arquitectura modular ya implementada en el repositorio principal.

El MVP queda centrado en la jerarquía:

- planificación de temporada
- microciclos
- sesiones

No intenta resolver todavía calendarios avanzados, carga interna, tareas o bibliotecas metodológicas.

## Integración con la suite

El módulo vive dentro de:

- `src/modules/planning/controllers`
- `src/modules/planning/models`
- `src/modules/planning/routes`
- `src/modules/planning/services`
- `src/views/modules/planning`

Y reutiliza:

- autenticación existente
- `club scope` desde `req.context.club`
- temporada activa desde `req.context.activeSeason`
- alcance por equipo desde `userScopeService`
- activación por club mediante `requireModule('planning')`
- layout y navegación compartidos de la suite

## Modelo implementado

### season_plans

Planificación de temporada asociada a un equipo concreto.

Campos principales:

- `id`
- `club_id`
- `team_id`
- `season_label`
- `planning_model`
- `start_date`
- `end_date`
- `objective`
- `notes`
- `created_by`
- `created_at`
- `updated_at`

### plan_microcycles

Bloque metodológico dentro de una planificación.

Campos principales:

- `id`
- `season_plan_id`
- `name`
- `order_index`
- `start_date`
- `end_date`
- `objective`
- `phase`
- `notes`
- `created_at`
- `updated_at`

### plan_sessions

Sesión operativa dentro de un microciclo.

Campos principales:

- `id`
- `microcycle_id`
- `session_date`
- `title`
- `session_type`
- `duration_minutes`
- `objective`
- `contents`
- `notes`
- `created_at`
- `updated_at`

## Navegación del MVP

### Entrada principal

- `/planning`

Permite seleccionar el equipo visible en el contexto del usuario y muestra las planificaciones de temporada del equipo elegido.

### Desde ficha de equipo

Cuando el módulo está activo, la ficha de equipo enlaza a:

- `/planning?team_id=<teamId>`

Esto abre el módulo ya contextualizado al equipo.

### Detalle de planificación

- `/planning/plans/:id`

Muestra:

- contexto de equipo
- resumen de la planificación
- listado de microciclos
- acceso a crear microciclo

### Detalle de microciclo

- `/planning/microcycles/:id`

Muestra:

- contexto de planificación
- datos del microciclo
- listado de sesiones
- acceso a crear sesión

## Alcance funcional actual

### Incluido

- listado de planificaciones por equipo
- creación, edición y borrado de planificación
- creación, edición y borrado de microciclos
- creación, edición y borrado de sesiones
- aislamiento por club y equipo
- acceso contextual desde la ficha de equipo

### Fuera del MVP

- tareas o ejercicios
- plantillas metodológicas avanzadas
- duplicación de microciclos
- calendario visual
- exportación
- métricas de carga
- integración con rival o partido

## Criterios de aislamiento

El módulo no muestra ni permite manipular:

- equipos fuera del club activo
- planificaciones de equipos fuera del alcance del usuario
- rutas del módulo cuando `planning` no está activo para el club

## Siguientes pasos recomendados

- añadir estados metodológicos por sesión
- duplicación rápida de microciclos
- vista calendario semanal
- plantillas reutilizables de microciclo
- relación futura con partido/rival cuando el producto lo requiera
