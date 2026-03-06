# Task Phase 2.1 - Compare

## Implementado

- Comparativa avanzada de jugadores con SSR:
  - `GET /evaluations/compare`
  - `POST /evaluations/compare`
- Selección de 2 a 4 jugadores.
- Filtros por:
  - temporada
  - sección
  - categoría
  - equipo
  - jugadores

## Servicios

- `comparisonService.js`
  - obtiene jugadores comparables
  - calcula medias globales
  - calcula medias por área
  - calcula medias por métrica
  - construye datasets del radar chart
  - detecta comparativas con muestra baja
- `playerAnalyticsService.js`
  - extendido con soporte para selección y analítica por lote

## UI

- Nueva vista `src/views/evaluations/compare.ejs`
- Incluye:
  - tarjeta de filtros
  - tarjetas resumen por jugador
  - radar chart con Chart.js
  - tabla detallada por métrica
  - resaltado del mejor valor por fila
  - estado vacío si hay menos de 2 jugadores
  - aviso de baja muestra cuando aplica

## Verificación

- Se mantiene Express + EJS + Bootstrap + MySQL.
- Toda la lógica de comparación queda en servicios.
- No se rompe el flujo existente de perfiles ni evaluaciones.
- Tests de integración añadidos para:
  - carga de página
  - comparación de 2 jugadores
  - filtros
  - estado vacío
- Verificado con `npm test`.
