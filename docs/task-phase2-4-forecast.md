# Task Phase2.4 - Prevision 26/27

## Implementado

- Nuevo modulo SSR `Prevision 26/27` con rutas:
  - `GET /season-forecast`
  - `GET /season-forecast/player/:id`
  - `GET /season-forecast/team/:id`
- Servicio [src/services/seasonForecastService.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/services/seasonForecastService.js) con reglas explicables para:
  - inferir categoria siguiente
  - calcular nivel de preparacion
  - medir tendencia reciente
  - generar recomendacion de coordinacion
  - construir explicaciones por jugador y resumen por equipo
- Controlador y rutas dedicadas:
  - [src/controllers/seasonForecastController.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/controllers/seasonForecastController.js)
  - [src/routes/seasonForecastRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/seasonForecastRoutes.js)
- Vistas nuevas:
  - [src/views/season-forecast/index.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/season-forecast/index.ejs)
  - [src/views/season-forecast/player.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/season-forecast/player.ejs)
  - [src/views/season-forecast/team.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/season-forecast/team.ejs)
- Integracion en navegacion lateral hacia `/season-forecast`
- Tests de integracion para:
  - render del indice
  - previsión individual
  - previsión de equipo
  - caso con datos insuficientes

## Reglas base

- La categoria siguiente se resuelve por edad y categoria actual.
- La preparacion usa media global y tendencia reciente.
- La recomendacion final usa:
  - media actual
  - tendencia
  - volumen de evaluaciones
  - señales de informes recientes si existen
- Todas las decisiones devuelven explicaciones visibles para coordinacion.
