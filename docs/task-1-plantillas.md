# Task 1 - Plantillas

## Implementado

- Layout global reutilizable con sidebar y topbar en EJS.
- Sidebar con navegación principal, club activo, temporada activa y resumen del usuario autenticado.
- Dominio estructural de academia:
  - `seasons`
  - `sections`
  - `categories`
  - `teams`
  - `team_players`
- Seeds por defecto para secciones y categorías.
- Extensión progresiva de `players` con campos relacionales y de contacto sin romper `team` legacy.
- Módulo `Plantillas` con MVC:
  - controlador `teamController`
  - modelos de temporada, sección, categoría, equipo y relación equipo-jugador
  - servicio `teamService`
  - rutas `/teams`
  - vistas `index`, `show` y `form`
- Listado de plantillas agrupado por sección y categoría con filtros, tarjetas, contador de jugadores y previews.
- Vista detalle de equipo con cabecera contextual y listado completo de jugadores.
- Inicialización de base de datos centralizada en `src/initDb.js`.
- Tests de integración para:
  - `GET /teams`
  - crear equipo
  - actualizar equipo
  - eliminar equipo
  - ver detalle de equipo

## Compatibilidad

- Se mantiene Express + EJS + Bootstrap + MySQL.
- No se introducen frameworks nuevos.
- El campo legacy `players.team` sigue disponible.
- Cuando existe `current_team_id`, las vistas y consultas priorizan el dato relacional.
