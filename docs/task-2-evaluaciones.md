# Task 2 - Evaluaciones

## Implementado

- Tablas nuevas:
  - `evaluations`
  - `evaluation_scores`
- Índices para histórico por jugador y filtros por equipo, temporada y autor.
- Estructura flexible de métricas por áreas en código, sin columnas por métrica en base de datos.
- Servicios:
  - `evaluationService.js`
    - valida notas
    - aplana métricas agrupadas
    - calcula media global
    - crea evaluación y puntuaciones en transacción
    - lista evaluaciones con filtros
    - agrupa evaluaciones por equipo
    - obtiene historial por jugador
  - `importEvaluationService.js`
    - procesa XLSX
    - valida filas
    - resuelve equipo y jugador
    - soporta `dryRun`
    - devuelve resumen de creadas, omitidas y errores
- Rutas:
  - `GET /evaluations`
  - `GET /evaluations/new`
  - `POST /evaluations`
  - `GET /evaluations/:id`
  - `GET /players/:id/evaluations`
  - `POST /evaluations/import`
- Vistas:
  - listado con filtros y agrupación por equipo
  - formulario manual por áreas
  - detalle con desglose completo
- Subida de Excel mediante `multer` en memoria.
- Tests de integración para:
  - creación manual
  - rechazo de notas inválidas
  - listado
  - historial de jugador
  - importación correcta
  - importación con filas inválidas

## Compatibilidad

- Se mantiene Express + EJS + Bootstrap + MySQL.
- No se toca el flujo legacy de informes.
- No se rompe el flujo actual de jugadores.
- La lógica de negocio y de importación queda fuera de EJS.
