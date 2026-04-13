# Product overview — SoccerProcessIQ Suite

Qué es
- SoccerProcessIQ Suite es una plataforma modular para la gestión deportiva de clubes de fútbol. Provee un núcleo operativo (SPI Core) y módulos opcionales que habilitan capacidades de scouting, planificación y análisis.

Problema que resuelve
- Consolidar flujos especializados (evaluaciones de jugadores, scouting de equipos rivales, planificación deportiva) en una única plataforma extensible que puede activarse por club.

Visión
- Permitir a cada organización activar solo los módulos que necesita, mantener una base estable y compartida (Core) y evolucionar funcionalmente sin romper integraciones existentes.

Estructura Core + módulos
- SPI Core: servicios comunes, autenticación, gestión de clubes, usuarios, sesiones, base de datos y utilidades compartidas.
- Módulos existentes en este repositorio:
  - `scouting_players` — informes individuales, evaluaciones y perfiles de jugador (implementación histórica del proyecto).
  - `scouting_teams` — scouting de equipos rivales y análisis táctico (módulo separado bajo `src/modules/scoutingTeams`).
  - `planning` — capacidades de planificación deportiva (carpeta `src/modules/planning`).

Dónde mirar en el código
- Núcleo: [src/core](src/core)
- Módulos: [src/modules](src/modules)
- Middleware de módulos y activación por club: [src/middleware/moduleMiddleware.js](src/middleware/moduleMiddleware.js)
- Servicio de módulos por club: [src/shared/services/clubModuleService.js](src/shared/services/clubModuleService.js)

Observación
- Este repositorio contiene principalmente el módulo de "Scouting Players" junto con el soporte del Core para multi‑módulos. La activación por club se almacena en la tabla `club_modules` (ver `src/core/models/clubModuleModel.js`).
