# Task Phase 2.3 - Season Comparison

## Implementado

- Nuevo módulo de comparativa entre temporadas:
  - `GET /season-comparison`
  - `GET /season-comparison/player/:id`
  - `GET /season-comparison/team/:id`

## Servicio

- `seasonComparisonService.js`
  - compara jugador entre dos temporadas
  - compara equipo entre dos temporadas
  - calcula deltas
  - prepara datos del radar chart
  - detecta ausencia de datos comparables
- Reutiliza `playerAnalyticsService` donde aporta valor y mantiene consultas agregadas para equipos.

## Vistas

- `src/views/season-comparison/index.ejs`
- `src/views/season-comparison/player.ejs`
- `src/views/season-comparison/team.ejs`

## Funcionalidad

- Comparativa de jugador:
  - media global
  - medias por área
  - número de evaluaciones
  - radar chart con 2 datasets
  - tabla de evolución por métrica
  - variaciones con badges positivas/negativas
- Comparativa de equipo:
  - total de jugadores
  - jugadores evaluados
  - media del equipo
  - pendientes
  - deltas por área
- Filtros por:
  - temporada origen
  - temporada destino
  - sección
  - categoría
  - equipo
  - jugador

## Verificación

- SSR puro con EJS.
- Sin reescribir analítica existente.
- Uso de consultas agregadas.
- Tests añadidos para:
  - render de página base
  - comparativa de jugador
  - comparativa de equipo
  - estado vacío sin datos en una temporada
- Verificado con `npm test`.
