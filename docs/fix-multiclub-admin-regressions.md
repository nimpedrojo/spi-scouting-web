# Fix multiclub admin regressions

## Regresiones corregidas

- Se restauró la administración de clubes en `/clubs` sin quitar compatibilidad con `/admin/clubs`
- Se restauró la asignación explícita de usuario a club mediante `club_id`
- Se recuperó la visibilidad de equipos legacy en la pantalla de configuración de club
- Se mantuvo separado el contexto operativo en sesión del flujo administrativo

## Separación de responsabilidades

- Contexto operativo en sesión:
  - `req.session.clubId`
  - `req.session.seasonId`
  - `req.session.seasonName` pendiente de ampliación futura si se quiere persistir siempre
- Configuración administrativa:
  - CRUD de clubes
  - edición explícita de `club_id` en usuarios
  - configuración de equipos legacy y recomendaciones del club

## Compatibilidad mantenida

- Equipos legacy:
  - tabla `club_teams`
  - usados en `admin/club`
- Equipos v2:
  - `teams`, `seasons`, `sections`, `categories`, `team_players`
  - usados por Plantillas y flujos operativos
- La pantalla de configuración de club muestra ambos sin mezclar responsabilidades

## Archivos principales

- [src/services/clubAdminService.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/services/clubAdminService.js)
- [src/routes/clubAdminRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/clubAdminRoutes.js)
- [src/routes/clubConfigRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/clubConfigRoutes.js)
- [src/routes/userAdminRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/userAdminRoutes.js)
- [src/models/userModel.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/models/userModel.js)
- [src/views/club/config.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/club/config.ejs)
- [src/views/clubs/index.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/clubs/index.ejs)
- [src/views/clubs/form.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/clubs/form.ejs)
- [src/views/users/form.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/users/form.ejs)

## Trabajo pendiente

- Si en una fase futura se migra completamente a `club_id` en todos los módulos administrativos, conviene retirar dependencias de `default_club` por nombre.
- La compatibilidad entre equipos legacy y v2 sigue siendo temporal y debería consolidarse en una migración explícita posterior.
