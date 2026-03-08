# Fix club admin regression

## Corregido

- Se restauró la administración de clubes con rutas operativas:
  - `GET /clubs`
  - `GET /clubs/new`
  - `POST /clubs`
  - `GET /clubs/:id/edit`
  - `POST /clubs/:id/update`
- Se mantuvo compatibilidad con `/admin/clubs`
- Se restauró el acceso visual a clubes para `superadmin` en la navegación

## Separación de conceptos

- Contexto operativo:
  - `req.session.clubId`
  - `req.session.seasonId`
  - usado por dashboard y módulos funcionales
- Configuración administrativa:
  - `club_id` explícito en formularios de usuario
  - CRUD de clubes independiente del contexto activo

## Usuarios

- `users` ahora soporta `club_id`
- alta y edición administrativa permiten asignar club explícitamente
- se mantiene `default_club` para compatibilidad con flujos actuales
- `club_id` y `default_club` se sincronizan al guardar

## Archivos principales

- [src/routes/clubAdminRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/clubAdminRoutes.js)
- [src/routes/userAdminRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/userAdminRoutes.js)
- [src/models/userModel.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/models/userModel.js)
- [src/middleware/sessionContext.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/middleware/sessionContext.js)
- [src/views/clubs/index.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/clubs/index.ejs)
- [src/views/clubs/form.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/clubs/form.ejs)
- [src/views/users/form.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/users/form.ejs)

## Tests añadidos

- listado de clubes
- creación de club
- edición de club
- creación de usuario con club asignado
- edición de asignación de club en usuario
