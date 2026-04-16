# SoccerProcessIQ Suite

SoccerProcessIQ Suite — Modular Football Club Platform.

Este repositorio contiene la implementación del módulo histórico de scouting de jugadores dentro de la suite modular "SoccerProcessIQ Suite". La aplicación base está construida con **Node.js**, **Express** y **EJS**, usa MySQL como base de datos y Bootstrap para la interfaz.

Nota de transición: este proyecto era conocido previamente como "SoccerReport"; el código y las rutas existentes mantienen compatibilidad, pero la documentación y el posicionamiento ahora reflejan la arquitectura modular y la visión de suite.

## Funcionalidad principal

- **Autenticación de usuarios**
  - Registro y login de usuarios.
  - Roles: `user`, `admin` y `superadmin`.
  - Gestión de sesión con `express-session` y mensajes flash.

- **Panel principal (dashboard)**
  - Tras iniciar sesión se muestra un panel con tarjetas (cards) que dan acceso rápido a:
    - `Nuevo informe` (todos los usuarios).
    - `Mi cuenta` (todos los usuarios).
    - Bloque de **informes** (creación, listado global).
    - Bloque de **administración y gestión** (jugadores, usuarios, configuración de club y listado de clubes para superadmin).

- **Informes de jugadores**
  - Creación de informes con datos generales del jugador (nombre, año, club, equipo, posiciones, contacto, etc.).
  - Valoraciones técnicas, tácticas, físicas, psicológicas y de personalidad con cálculo automático de medias y valoración global.
  - Listado de informes (solo administradores), detalle y edición.
  - Borrado individual y borrado múltiple de informes con confirmación.
  - Exportación de informes a una plantilla Excel (`.xlsm`) a partir de los datos guardados.
  - API JSON (`/reports/api/:id`) para consumir los datos del informe desde Excel u otras integraciones.

- **Base de datos de jugadores**
  - Tabla `players` alimentada desde un Excel (por ejemplo `Deportistas_2025.xlsx`) mediante el script de importación.
  - Datos guardados por jugador: nombre, apellidos, equipo, fecha de nacimiento, año de nacimiento y lateralidad.
  - En el formulario de **Nuevo informe** hay un desplegable de jugadores:
    - Por defecto muestra solo los jugadores del equipo configurado en la cuenta del usuario; si no hay coincidencias, muestra todos.
    - Al seleccionar un jugador se rellenan automáticamente nombre, apellidos, equipo, año y lateralidad del informe.

- **Cuenta de usuario y configuración por defecto**
  - Cada usuario puede editar:
    - Nombre y email.
    - Club y equipo por defecto.
  - El equipo por defecto debe ser uno de los equipos configurados para el club en la sección de configuración; si aún no hay club/equipos, se usa `-` como marcador hasta que se escoja.
  - Al crear un informe nuevo, el formulario de **Club** y **Equipo** se pre‑rellena con esos valores y, si se dejan vacíos, se guardan como valores por defecto.

- **Gestión de usuarios (admin / superadmin)**
  - Listado de usuarios registrados con nombre, email, rol y configuraciones por defecto.
  - Edición de datos básicos de cualquier usuario.
  - Cambio de rol (`user`, `admin`, `superadmin` —solo modificable por superadmin).
  - Borrado individual y borrado múltiple de usuarios (no permite borrar el usuario con sesión activa).
  - Al borrar usuarios se desvinculan sus informes (campo `created_by` pasa a `NULL`) para no perder la información de los reports.

- **Gestión de clubes (solo superadmin)**
  - Alta de clubes con nombre y código de registro.
  - Edición del nombre del club (el código de registro no se modifica).
  - Borrado de clubes, eliminando también los usuarios asociados a ese club (sus informes quedan desvinculados).

- **Configuración de club (admin / superadmin)**
  - Desde `/admin/club`, para el club por defecto del usuario:
    - Configuración de equipos (`club_teams`): alta, renombrado y borrado.
    - Resumen de usuarios, jugadores e informes asociados al club.
    - Configuración del mapeo **año → opciones de recomendación** que se usa en el desplegable de recomendación del formulario de informes.

- **Gestión de jugadores (admin / superadmin)**
  - Listado de jugadores de la tabla `players`.
  - Edición de datos básicos (nombre, apellidos, equipo, año y lateralidad).
  - Borrado individual y borrado múltiple de jugadores.
  - Alta manual de jugadores:
    - El admin asigna siempre el club por defecto del usuario.
    - El superadmin puede escoger el club para el que da de alta el jugador.

## Estructura básica del proyecto

- `src/app.js` – Configuración principal de Express y middlewares.
- `src/server.js` – Arranque del servidor y creación de tablas iniciales.
- `src/db.js` – Pool de conexión MySQL.
- `src/models/` – Modelos de acceso a datos (`userModel`, `reportModel`, `playerModel`, `clubModel`, `clubTeamModel`, `clubRecommendationModel`, etc.).
- `src/routes/` – Rutas de autenticación, informes, administración de usuarios, jugadores, clubes y configuración de club.
- `src/views/` – Vistas EJS (layout general, login/registro, dashboard, informes, cuenta, usuarios, jugadores, clubes y configuración de club).
- `src/public/` – Recursos estáticos (CSS, iconos del dashboard, etc.).
- `scripts/import_players_from_excel.js` – Script para importar jugadores desde un Excel a la tabla `players`.
- `tests/app.test.js` – Tests de regresión con Jest + Supertest.

## Puesta en marcha

1. Instalar dependencias:

```bash
npm install
```

2. Configurar variables de entorno en `.env` (ver `.env.example` si existe):

- Conexión a MySQL (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, etc.).
- Usuario superadmin inicial (`ADMIN_EMAIL`, `ADMIN_PASSWORD` opcional).  
  Si no se especifican, se usará `admin@local` / `admin`.
- Clave de sesión (`SESSION_SECRET`).

3. Crear la base de datos vacía en MySQL (por ejemplo `soccer_report`).  
   Al arrancar la app se crearán las tablas necesarias si no existen.

4. Ejecutar en desarrollo:

```bash
npm run dev
```

5. Abrir en el navegador:

- Ir a `http://localhost:3000/login` para iniciar sesión.
- Tras el login se mostrará el **dashboard** con las opciones disponibles según el rol.

## Importación de jugadores desde Excel

- El script `scripts/import_players_from_excel.js` permite cargar la tabla `players` desde un Excel (por ejemplo `Deportistas_2025.xlsx`):
  - Usa por defecto la ruta definida en `PLAYERS_EXCEL_PATH` (variable de entorno) o una ruta local.
  - Soporta fechas de nacimiento tanto como fechas reales como números de serie de Excel (por ejemplo `41511`), convirtiéndolas automáticamente a `YYYY-MM-DD` y año (`birth_year`).
  - Importa nombre, apellidos, equipo, fecha de nacimiento, año de nacimiento y lateralidad.

Ejecutar:

```bash
npm run import:players
```

## Tests

La aplicación incluye tests de regresión con Jest + Supertest para comprobar flujos de autenticación, dashboard, cuenta, gestión de usuarios, configuración de club y API de informes.

Ejecutar la suite de tests:

```bash
npm test
```

## Notas

- La exportación a Excel usa una plantilla `.xlsm` y la librería `xlsx`. Debido a limitaciones de la librería open‑source, la generación de Excel con formato avanzado se realiza preferentemente desde una macro en el propio Excel consumiendo la API JSON.
- El código está pensado para uso personal / interno; no incluye todas las medidas de seguridad y hardening necesarias para un entorno de producción expuesto a Internet.
