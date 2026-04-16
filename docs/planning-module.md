# SPI Planning module

## Objetivo del MVP

Convertir `SPI Planning` en un módulo operativo y contextual al equipo dentro de `SoccerProcessIQ Suite`, reutilizando la arquitectura modular ya implementada en el repositorio principal.

El MVP queda centrado en la jerarquía:

- planificación de temporada
- microciclos
- sesiones
- tareas por sesión

No intenta resolver todavía calendarios avanzados, carga interna o bibliotecas metodológicas avanzadas.

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
- `status`
- `objective`
- `contents`
- `notes`
- `created_at`
- `updated_at`

### plan_session_tasks

Tareas operativas ligadas a una sesión concreta.

Campos principales:

- `id`
- `session_id`
- `sort_order`
- `title`
- `task_type`
- `duration_minutes`
- `objective`
- `details`
- `space`
- `age_group`
- `player_count`
- `complexity`
- `strategy`
- `coordinative_skills`
- `tactical_intention`
- `dynamics`
- `game_situation`
- `coordination`
- `explanatory_image_path`
- `contents`
- `notes`
- `created_at`
- `updated_at`

### planning_microcycle_templates

Plantillas reutilizables de microciclo ligadas a un equipo.

Campos principales:

- `id`
- `club_id`
- `team_id`
- `name`
- `phase`
- `objective`
- `notes`
- `created_by`
- `created_at`
- `updated_at`

### planning_microcycle_template_sessions

Sesiones base opcionales que cuelgan de una plantilla reutilizable.

Campos principales:

- `id`
- `template_id`
- `day_offset`
- `sort_order`
- `title`
- `session_type`
- `duration_minutes`
- `status`
- `objective`
- `contents`
- `notes`
- `created_at`
- `updated_at`

### planning_microcycle_template_session_tasks

Tareas base opcionales que cuelgan de una sesión plantilla.

Campos principales:

- `id`
- `template_session_id`
- `sort_order`
- `title`
- `task_type`
- `duration_minutes`
- `objective`
- `details`
- `space`
- `age_group`
- `player_count`
- `complexity`
- `strategy`
- `coordinative_skills`
- `tactical_intention`
- `dynamics`
- `game_situation`
- `coordination`
- `explanatory_image_path`
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
- acceso a abrir cada sesión como ficha operativa
- resumen por estado
- vista semanal simple
- acceso a crear sesión
- acceso a duplicar el microciclo
- acceso a guardarlo como plantilla reutilizable

### Detalle de sesión

- `/planning/sessions/:id`

Muestra:

- contexto de sesión
- datos principales
- listado de tareas
- acceso a crear, editar y borrar tareas
- imagen explicativa opcional por tarea
- campos metodológicos básicos para describir la tarea

### Plantillas reutilizables

- `/planning/templates/new?microcycle_id=<id>`

Permite guardar un microciclo como plantilla del equipo y reutilizarla después al crear nuevos microciclos.

## Alcance funcional actual

### Incluido

- listado de planificaciones por equipo
- creación, edición y borrado de planificación
- creación, edición y borrado de microciclos
- creación, edición y borrado de sesiones
- creación, edición y borrado de tareas dentro de cada sesión
- soporte visual y descriptivo ampliado para tareas
- estados simples de sesión: `planned`, `done`, `cancelled`
- duplicación rápida de microciclos con sus sesiones
- duplicación de tareas al duplicar microciclos
- guardado de microciclos como plantillas reutilizables del equipo
- creación de microciclos desde plantilla con sesiones base y tareas base
- vista semanal simple del microciclo
- aislamiento por club y equipo
- acceso contextual desde la ficha de equipo

### Fuera del MVP

- ejercicios detallados con métricas avanzadas
- plantillas metodológicas avanzadas con editor propio
- calendario visual avanzado
- exportación
- métricas de carga
- integración con rival o partido

## Criterios de aislamiento

El módulo no muestra ni permite manipular:

- equipos fuera del club activo
- planificaciones de equipos fuera del alcance del usuario
- rutas del módulo cuando `planning` no está activo para el club

## Siguientes pasos recomendados

- duplicación selectiva de sesiones o bloques
- edición avanzada de plantillas reutilizables
- calendario semanal con vista más táctica
- métricas simples de carga por tarea y por sesión
