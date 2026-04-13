# Technical architecture

Stack actual
- Runtime: Node.js
- Framework: Express
- Templates: EJS + `express-ejs-layouts`
- DB: MySQL (`mysql2`)
- Tests: Jest + Supertest
- Otros: `dotenv`, `morgan`, `bcryptjs`, `xlsx` (export/imports), `multer`.

Estructura del proyecto (relevante)
- `src/server.js` — arranque, creación inicial de tablas.
- `src/app.js` — configuración de Express, middlewares y montaje de rutas (core + módulos).
- `src/core/` — controladores y modelos pertenecientes al núcleo del sistema.
- `src/modules/` — cada módulo independiente con sus rutas, controladores y vistas (`scoutingPlayers`, `scoutingTeams`, `planning`).
- `src/shared/` — servicios reutilizables, constantes y utilidades compartidas entre Core y módulos.
- `src/middleware/` — middlewares de contexto (sesión, clubScope, módulos) que posibilitan la arquitectura multi‑club y multi‑módulo.

Arquitectura modular
- Módulos como unidades desplegables: cada módulo se implementa bajo `src/modules/<moduleName>` y expone rutas que el `src/app.js` monta en puntos concretos.
- El Core expone hooks de contexto (branding, club, temporada) que los módulos consumen a través de `req.context`.
- Control de acceso a módulos: `requireModule(moduleKey)` se usa en rutas para bloquear funcionalidad cuando el módulo no está habilitado para el club.

Sistema de módulos por club
- Implementación persistente: tabla `club_modules` (modelo en `src/core/models/clubModuleModel.js`).
- Presets y metadatos: definidos en `src/shared/services/clubModuleService.js` como `CLUB_MODULE_PRESETS` y `CLUB_MODULE_META`.
- Flujo de habilitación/uso:
  1. Al crear/registrar un club, `ensureDefaultModulesForClub` inserta entradas por defecto en `club_modules`.
  2. `getClubModuleState(clubId)` construye el estado (lista de módulos y `activeModuleKeys`).
  3. `attachModuleContext` añade `req.context.activeModuleKeys` para que vistas y layouts muestren sólo módulos activos.
  4. `requireModule` protege el acceso a rutas y devuelve vistas/JSON de error si el módulo está deshabilitado.

Notas de implementación y coherencia
- No hay un sistema de plugins que cargue dinámicamente paquetes npm por módulo: la modularidad aquí está basada en organización del código y en control de rutas/funcionalidad por clave de módulo.
- La activación es por club y almacenada en la base de datos; el despliegue sigue siendo una única aplicación que sirve a varios clubes (multi‑tenant a nivel de datos/club context).
