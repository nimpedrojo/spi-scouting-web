# AGENTS.md — Informes STV

Este proyecto es una aplicación Node.js/Express con EJS para gestionar informes de scouting de jugadores del club Stadium Venecia. Las siguientes normas están pensadas para cualquier agente que modifique este repositorio.

## Arquitectura y stack

- Backend: Node.js + Express.
- Vistas: EJS con un layout principal `src/views/layout.ejs`.
- Estilos: CSS propio en `src/public/css/styles.css` + Bootstrap 5 vía CDN.
- BD: MySQL, acceso mediante modelos en `src/models/*.js`.
- Tests: Jest + Supertest (`tests/app.test.js`).
- Servidor de arranque: `src/server.js` (inicializa tablas y arranca Express).
- App principal: `src/app.js` (middlewares, sesiones, rutas).

## Convenciones generales

- Usa **CommonJS** (`require/module.exports`) para módulos de Node.
- Mantén rutas, modelos y vistas coherentes:
  - Rutas en `src/routes/`.
  - Modelos de datos en `src/models/`.
  - Vistas EJS en `src/views/`.
- No cambies la forma básica de inicializar la app:
  - Tablas se crean en `init()` dentro de `src/server.js`.
  - `app.js` no debe hacer trabajo de inicialización de BD ni escuchar el puerto.
- Mantén la paleta y branding actuales:
  - Color base: rojo (`--sv-red`, `--sv-red-dark`).
  - Logos:
    - Navbar: `/img/logo-stadium.png`.
    - Login: `/img/logo-stadium-login.png` (dentro de `.login-card`).

## Estilo de código

- JavaScript:
  - Usa `async/await` para operaciones asíncronas.
  - Maneja errores con `try/catch` en rutas y reporta con `console.error` cuando sea relevante.
  - Mantén las funciones de acceso a datos en los modelos, no en las rutas.
- Vistas EJS:
  - Reutiliza el layout principal (`layout.ejs`).
  - Evita lógica compleja en EJS; mejor preparar datos en la ruta.
  - Para scripts pequeños específicos de una vista (por ejemplo select-all, autocompletar), inclúyelos al final de la plantilla.
- CSS:
  - Extiende `src/public/css/styles.css` en lugar de crear múltiples ficheros de estilos.
  - Usa las variables definidas en `:root` para colores del club (rojo) y no introduzcas paletas paralelas.

## Rutas y seguridad

- Autenticación y roles:
  - Usa `ensureAuth` para rutas que requieran usuario logueado.
  - Usa `ensureAdmin` para rutas de administración (informes globales, usuarios).
- Sesiones:
  - Mantén el uso de `express-session` tal y como está configurado en `app.js`.
  - No guardes información sensible en la sesión más allá de `id`, `name`, `email`, `role` y defaults.
- Exportaciones:
  - Para CSV u otros formatos de descarga, establece correctamente:
    - `Content-Type`.
    - `Content-Disposition` con un nombre de archivo descriptivo.

## Base de datos

- Tablas principales:
  - `users`: incluye `role`, `default_club`, `default_team`.
  - `reports`: todos los campos de informe más `created_by` y `created_at`.
  - `players`: base de jugadores importada desde Excel.
- Migraciones “suaves”:
  - Cuando añadas columnas nuevas, sigue el patrón actual:
    - `CREATE TABLE IF NOT EXISTS`.
    - `ALTER TABLE ... ADD COLUMN ...` dentro de `try/catch` ignorando `ER_DUP_FIELDNAME`.
- Relaciones:
  - `reports.created_by` referencia `users.id`, pero se permite `NULL`.
  - Antes de borrar usuarios, desvincula sus informes (`created_by = NULL`).

## Funcionalidad clave existente (no romper)

- **Dashboard**:
  - `/dashboard` es la pantalla principal tras login, con cards según el rol.
- **Informes**:
  - Creación desde `/reports/new` con autocompletado de jugador desde `players`.
  - Listado, edición, borrado individual y múltiple.
  - Exportación a Excel desde plantilla `.xlsm`.
  - Exportación a CSV desde `/reports/export/csv` con encabezado.
  - API JSON `/reports/api/:id`.
- **Cuenta**:
  - `/account` permite editar datos del usuario y defaults (club/equipo) con desplegable de equipos desde `players`.
- **Administración**:
  - `/admin/users` permite listar, editar, cambiar rol, borrar (individual y múltiple) usuarios.

## Tests

- Usa y amplía `tests/app.test.js` para cualquier nueva funcionalidad de rutas.
  - Preferir `request.agent(app)` para flujos con sesión.
  - Cuando crees datos directamente en la BD dentro de tests, límpialos comprobando efectos (selects) en el mismo test.
- Antes de finalizar cambios, ejecuta:

  ```bash
  npm test
  ```

  y asegúrate de que la suite pasa.
- Una vez que la suite pase elimina los registros de prueba de la BBDD   

## Scripts útiles

- Importar jugadores desde Excel:

  ```bash
  npm run import:players
  ```

  - Usa por defecto `PLAYERS_EXCEL_PATH=/Users/.../Deportistas_2025.xlsx`.
  - Si cambias rutas, documenta el cambio en el README.

## Qué evitar

- No mezclar estilos de autenticación (no introducir otros sistemas distintos a sesiones ya existentes).
- No mover grandes piezas (como cambiar Express/EJS por otro framework) dentro de este agente.
- No cambiar la semántica de rutas públicas ya usadas (`/login`, `/dashboard`, `/reports`, `/admin/users`) sin actualizar tests y README.
- No introducir dependencias de pago.

Si necesitas nuevas capacidades (p.ej. filtros avanzados, nuevos formatos de exportación), sigue la estructura actual: modelos para datos, rutas para lógica HTTP, vistas para renderizado y tests que cubran los flujos principales.

