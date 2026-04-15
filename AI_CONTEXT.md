# SoccerProcessIQ Suite — AI Context Document

## 1. What this project is

SoccerProcessIQ Suite is a server-rendered football operations platform for academies and clubs.

It started as a scouting report manager and is evolving into a broader academy coordination suite.

Primary business areas:

- clubs
- seasons
- sections
- categories
- teams
- players
- scouting reports
- player evaluations
- user and access management
- planning workflows
- rival scouting

Primary users:

- coaches
- coordinators
- academy technical staff
- club admins
- platform superadmins

The app is designed as a simple VPS-deployed monolith, not a distributed system.

## 2. Stack and non-negotiable constraints

Backend:

- Node.js
- Express

Frontend:

- EJS
- Bootstrap
- server-side rendering only

Database:

- MySQL
- `mysql2/promise`

Testing:

- Jest
- Supertest

Uploads:

- `multer`

Excel import/export:

- `xlsx`

Do not introduce:

- React
- Vue
- TypeScript
- Prisma
- GraphQL
- Docker as a core architectural requirement

The system must evolve incrementally and preserve compatibility with current modules.

## 3. Current architectural shape

The codebase is a monolithic Express app with a mixed structure:

- `src/routes`, `src/controllers`, `src/models`, `src/services`, `src/views` contain the shared/core app
- `src/modules/*` contains newer feature modules that plug into the app
- `src/core/*` contains route aggregation and some cross-cutting core models
- `src/shared/*` contains shared constants and services used by modules

This means the app is partially modularized, but not fully isolated by bounded contexts. A future AI should not assume a clean module-per-domain architecture already exists.

Important practical reality:

- there is legacy/shared code in `src/routes` and `src/controllers`
- there are newer modules in `src/modules/scoutingPlayers`, `src/modules/scoutingTeams`, and `src/modules/planning`
- many domain services are still in `src/services`
- views are mostly under `src/views`, even when route registration comes from module folders

## 4. High-level app boot flow

Entry and boot:

- `src/server.js` starts the server
- `src/app.js` builds the Express app
- `src/initDb.js` initializes the schema at startup

Request pipeline in `src/app.js`:

1. request logger
2. body parsing
3. EJS + layouts setup
4. session middleware
5. flash messages
6. session context attachment
7. module context attachment
8. locals exposed to EJS
9. static assets
10. route mounting

Important middleware:

- `attachSessionContext`: resolves active user, club, and active season into `req.context`
- `attachModuleContext`: resolves enabled/disabled club modules into `req.context.activeModuleKeys`
- `ensureAuth`: requires a logged-in session
- `ensureAdmin` / `requireRole(...)`: enforce role-based access

Important locals exposed to views:

- `currentUser`
- `success`
- `error`
- `activeRoute`
- `activeClubName`
- `activeClubBranding`
- `activeSeasonLabel`
- `pageTitle`
- `activeModules`

## 5. Route map by business area

### Core routes

Mounted from `src/core/routes/index.js`.

Main route groups:

- auth: `src/routes/authRoutes.js`
- users admin: `/admin/users`
- clubs admin: `/admin/clubs` and `/clubs`
- club config: `/admin/club`
- teams: `/teams`
- player admin: `/admin/players`
- player profile base route: `/players/:id`

### Scouting Players module

Mounted from `src/modules/scoutingPlayers/routes/index.js`.

Main capabilities:

- reports: `/reports`
- assessments hub: `/assessments`
- evaluations: `/evaluations`
- player evaluation history: `/players/:id/evaluations`
- season comparison
- season forecast
- evaluation templates
- player PDF views

Important nuance:

- the player profile HTML route `/players/:id` is intentionally available even when `scouting_players` is disabled
- premium blocks inside the profile are degraded to disabled states instead of failing
- PDF and other premium routes remain protected by the module gate

### Planning module

Mounted at `/planning`.

Current entities:

- season plans
- microcycles
- sessions
- session tasks
- microcycle templates

Planning is functional but still clearly an MVP. It already supports CRUD-style workflows and task image uploads.

### Scouting Teams module

Mounted at `/scouting-teams`.

Current capabilities:

- list reports
- create report
- detail view
- edit report
- delete report

Permissions are more granular here:

- some users can create
- report editing depends on ownership/role
- deleting is more restricted

## 6. Module system

Feature activation is club-scoped.

Current module keys in `src/shared/constants/moduleKeys.js`:

- `scouting_players`
- `planning`
- `scouting_teams`

Default state:

- `scouting_players`: enabled
- `planning`: disabled
- `scouting_teams`: disabled

Module logic lives mainly in:

- `src/middleware/moduleMiddleware.js`
- `src/shared/services/clubModuleService.js`
- `src/core/models/clubModuleModel.js`

Module behavior:

- routes can be protected with `requireModule(moduleKey)`
- if disabled, HTML requests render `src/views/errors/module-disabled.ejs`
- JSON requests get `403` with `MODULE_DISABLED`
- the module state is also exposed to the UI via `activeModules`

The dashboard and team detail pages are module-aware and build action cards dynamically based on active modules.

## 6.1 Product mode system

The suite now supports a product exposure layer that is separate from club modules.

Current product modes:

- `suite`
- `pmv_player_tracking`

Intended meaning:

- `suite`: full modular SoccerProcessIQ Suite experience
- `pmv_player_tracking`: simplified experience focused on SPI Player Tracking without removing underlying functionality

PMV intent:

- present a sellable, simpler experience for player tracking
- reinforce the operational flow `team -> player -> report/evaluation -> player profile`
- reduce visible noise while keeping suite compatibility

Resolution model:

- there is a global platform default product mode
- each club can optionally override that value
- if a club has no override, the global default applies

Important distinction:

- modules control functional availability
- product mode controls product exposure, navigation, and prioritization

That means a route can still exist and a module can still be active, while the PMV mode hides that capability from the main UI.

## 7. Roles and access model

Main roles:

- `superadmin`
- `admin`
- `user`

Simplified behavior:

- `superadmin`: global platform administration
- `admin`: club-level administration
- `user`: usually scoped to a default team

Updated product interpretation:

- `superadmin` is not just another privileged end user
- `superadmin` acts as platform administrator
- platform administration includes clubs, product mode defaults, club configuration access, and global navigation governance

Important service:

- `src/services/userScopeService.js`

Scope rules:

- privileged users (`admin`, `superadmin`) can access all teams/players in scope
- regular `user` is commonly restricted to `default_team_id`
- player access is verified against team membership
- some screens filter teams/players according to the logged-in user's scope

This scoped-access model is important. Do not assume all authenticated users can see all players or teams.

## 8. Club/season operational context

The app is heavily context-driven.

Session context typically contains:

- active user
- default club
- active club object
- active season object
- enabled modules

Key source:

- `src/middleware/sessionContext.js`

Consequences:

- many controllers expect `req.context.club`
- many flows use the active season implicitly when the request does not specify one
- if there is no active club, some modules render degraded states or redirect to dashboard/account

## 9. Domain model and core tables

Database schema is created in code at boot, without a formal migration framework.

Initialization order is defined in `src/initDb.js`.

Current important tables:

- `clubs`
- `club_recommendations`
- `seasons`
- `sections`
- `categories`
- `teams`
- `users`
- `club_modules`
- `season_plans`
- `plan_microcycles`
- `plan_sessions`
- `plan_session_tasks`
- `planning_microcycle_templates`
- `scouting_team_opponents`
- `scouting_team_reports`
- `reports`
- `players`
- `team_players`
- `evaluations`
- `evaluation_scores`
- `evaluation_templates`
- `evaluation_template_metrics`

Important modeling notes:

- some tables use UUID-based string ids, especially newer domain entities like teams, seasons, planning entities
- some older tables still use integer autoincrement ids, especially `players`, `reports`, and `users`
- the system is therefore mixed-id, not uniformly UUID-only
- `team_players` is the roster/assignment join table and stores useful team-specific player metadata such as dorsal and positions
- evaluations use a flexible score structure split across `evaluations` and `evaluation_scores`

Important business entities:

- club
- season
- section
- category
- team
- player
- report
- evaluation
- evaluation template
- user

## 10. Current major functional modules

### 10.1 Dashboard

Controller:

- `src/controllers/dashboardController.js`

Purpose:

- central operational landing page
- mixes core entries and module entries
- shows club-level metrics and module-specific shortcuts

It is module-aware and context-aware.

It is also now product-mode-aware:

- in `suite` mode it behaves as the modular suite dashboard
- in `pmv_player_tracking` it prioritizes recent activity, player tracking value, and simpler entry points
- in `pmv_player_tracking` it should feel like a work dashboard, not just a navigation hub

### 10.2 Teams / Plantillas

Routes:

- `/teams`

Controller:

- `src/controllers/teamController.js`

Services:

- `src/services/teamService.js`
- `src/services/processIqTeamImportService.js`
- `src/services/processIqPlayerImportService.js`

Capabilities:

- list teams grouped by section/category
- create/edit/delete teams
- team detail workspace
- roster display
- contextual shortcuts to enabled modules
- ProcessIQ import preview and confirm
- ProcessIQ player import by team or bulk

This area is operationally central. Many other flows use `team_id` as a context anchor.

Recent platform-oriented nuance:

- superadmin can now work with team management through explicit club selection, instead of requiring a default operational club

### 10.3 Players

Admin routes:

- `/admin/players`

Profile routes:

- `/players/:id`

Capabilities:

- create and edit player profiles
- upload player photo
- view player profile
- show core profile info even if premium module is disabled

Important nuance:

- player profile blends core player data with premium scouting/evaluation data when that module is active
- if `scouting_players` is disabled, premium sections must degrade gracefully rather than crash
- in `pmv_player_tracking`, the player profile is one of the primary value screens and should be treated as a flagship view
- PMV flow expectation:
  - open team
  - enter player profile
  - create report/evaluation with player context preserved when possible
  - return clearly to player profile to review history and summary
- PMV player profile priorities:
  - clean header with immediate actions
  - quick summary of status and latest activity
  - visible evaluation/report history
  - simple evolution view instead of an overloaded administrative layout
  - simple benchmark against current team average when there is enough evaluation base

### 10.4 Reports

Routes:

- `/reports`
- `/reports/new`

Model:

- `src/models/reportModel.js`

Characteristics:

- older scouting report subsystem
- report rows are wide and denormalized
- contains many explicit metric columns
- tied to player name/surname and club/team context
- still important to current product behavior

This subsystem is more legacy-shaped than evaluations.

### 10.3.1 PMV benchmark layer

The PMV now includes a lightweight comparative reading layer built from evaluations.

Team benchmark rules:

- context is strictly limited to current club, current team, active season, and players currently assigned to that team
- for each player, use up to the last 3 valid evaluations in the active season
- compute player area averages first
- compute team area averages by averaging player averages, not by averaging all raw evaluation rows directly
- team benchmark is shown only when at least 3 players have valid evaluation data

Player vs team rules:

- player profile can compare the player against the current team average in PMV mode
- comparison is shown only when:
  - the player has at least 1 valid evaluation
  - the team benchmark is valid

Areas used:

- tecnica
- tactica
- fisica
- psicologica
- personalidad

Global average rule:

- player global average: simple average of available player area averages
- team global average: simple average of available team area averages

### 10.5 Evaluations

Routes:

- `/evaluations`
- `/evaluations/new`
- `/evaluations/:id`
- `/players/:id/evaluations`
- `/evaluations/compare`
- `/evaluations/import`

Controller:

- `src/controllers/evaluationController.js`

Services:

- `src/services/evaluationService.js`
- `src/services/importEvaluationService.js`
- `src/services/comparisonService.js`
- `src/services/playerAnalyticsService.js`

Characteristics:

- more structured than reports
- support templates
- use `evaluation_scores` as flexible metric rows
- support manual creation
- support Excel import
- feed player profile analytics
- support comparison and forecast features

This is one of the most important business areas in the current suite.

### 10.6 Assessment hub

Route:

- `/assessments`

Controller:

- `src/controllers/assessmentHubController.js`

Purpose:

- unified landing page for scouting reports and evaluations
- acts as a high-level navigation hub inside `scouting_players`

### 10.7 Season comparison / forecast

Related controllers:

- `src/controllers/seasonComparisonController.js`
- `src/controllers/seasonForecastController.js`

Purpose:

- compare player/team performance across seasons
- generate projection/forecast-style views from evaluation data

These are value-added analytical features on top of the evaluations subsystem.

### 10.8 Planning

Module path:

- `/planning`

Controller:

- `src/modules/planning/controllers/planningController.js`

Current state:

- real CRUD workflows exist
- still feels like a growing module rather than a fully mature one
- uses its own models/services but still lives in the same monolith conventions

### 10.9 Scouting Teams

Module path:

- `/scouting-teams`

Controller:

- `src/modules/scoutingTeams/controllers/scoutingTeamsController.js`

Current state:

- module-gated
- club-scoped
- supports report lifecycle
- permission rules are more explicit than in some older areas

## 11. Data and business logic conventions

The codebase expects business logic to live in services, not views.

Preferred layering:

- controllers: request/response orchestration
- models: database access
- services: business logic and aggregation
- views: display only

This principle is not perfectly enforced everywhere, but it is the intended direction and should be preserved.

Examples of service-heavy areas:

- dashboard aggregation
- team workspace aggregation
- player analytics
- evaluation import
- comparison and forecast logic
- ProcessIQ import flows

## 12. UI conventions

Rendering model:

- fully server-rendered EJS
- Bootstrap-based
- consistent sidebar/topbar shell

Visual pattern:

- football academy dashboard style
- cards
- badges
- grouped lists
- progress/summary blocks
- analytical views with charts where useful

Do not redesign the app as a SPA.

## 13. External integrations

### ProcessIQ

The suite integrates with ProcessIQ for team/player import workflows.

Related services:

- `src/services/processIqTeamImportService.js`
- `src/services/processIqPlayerImportService.js`

Operational implications:

- some clubs/users store ProcessIQ credentials
- team imports can create local teams
- player imports can populate rosters
- imported entities coexist with manual entities

### Chart.js via CDN

Some analytical pages include Chart.js from a CDN in the EJS view when needed.

This is already an accepted pattern in the codebase.

## 14. File uploads and generated assets

Upload directories:

- `src/public/uploads/clubs`
- `src/public/uploads/players`
- `src/public/uploads/planning`

Typical uploaded assets:

- club crests
- player photos
- planning task explanatory images

Files are served as static assets from `src/public`.

## 15. Testing status

Current test file:

- `tests/app.test.js`

Characteristics:

- large integration-style Jest/Supertest suite
- covers authentication, access control, CRUD flows, module gating, imports, dashboard behavior, player profiles, PDF flows, planning, and scouting teams

Important practical note:

- tests are concentrated in one large file rather than split by module
- a future AI should preserve that style unless explicitly asked to refactor tests

When adding routes/features:

- add integration coverage in Jest/Supertest
- prefer following the existing test helpers and data setup patterns

## 16. Database and deployment behavior

Database connection:

- `src/db.js`

Environment variables:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `SESSION_SECRET`
- `NODE_ENV`

Schema behavior:

- `ensureDatabaseExists()` creates the DB if missing
- tables are created with `CREATE TABLE IF NOT EXISTS`
- some models also attempt incremental `ALTER TABLE ADD COLUMN`

This is a lightweight schema-evolution strategy, not a formal migration system.

## 17. Important implementation realities an AI must understand

### 17.1 This is not a greenfield codebase

There is a mix of:

- legacy report flows
- newer modular features
- shared controllers/models
- some duplicated concerns

An AI should prefer local, low-risk changes over broad rewrites.

### 17.2 Preserve compatibility

Must not break:

- authentication
- users
- clubs
- reports
- players
- scouting

### 17.3 SSR is mandatory

Any new page should be implemented with Express + EJS, not with client-side frameworks.

### 17.4 Business logic should move toward services

If a controller starts becoming large, refactor logic into `src/services`.

### 17.5 Module gating matters

Before using premium data or premium routes, check whether the club module is enabled.

Examples:

- `scouting_players`
- `planning`
- `scouting_teams`

### 17.6 Not every route should hard-fail when a module is disabled

Current example:

- `/players/:id` should still render core player information
- premium sections should appear disabled if `scouting_players` is off

This pattern is intentional because the UI also acts as a soft upsell surface.

### 17.7 The active club context is foundational

Many flows assume an active club.

If a request does not have a valid club context, the correct behavior is usually one of:

- redirect to dashboard
- redirect to account
- render a degraded state

### 17.8 Mixed identifiers are normal

Do not assume every table uses the same id strategy.

Examples:

- teams often use UUID strings
- players and reports often use numeric ids

### 17.9 There is intentional module-aware navigation

Sidebar, dashboard, and team workspaces expose only relevant module actions.

UI actions should respect `activeModules`.

### 17.10 Product mode is now a first-class concern

When changing navigation, dashboard composition, or visible entry points, consider:

- effective product mode
- active modules
- user role
- club/team scope

The correct order of reasoning is usually:

1. can the user access it
2. is the module enabled
3. should it be prominently visible in this product mode

## 18. Suggested mental model for another AI

Treat the app as:

1. a core football academy management shell
2. with club-scoped premium modules layered on top
3. in a monolithic Express/EJS architecture
4. backed by MySQL tables created in code
5. with incremental evolution favored over architectural purity

If you need to change something:

- first determine whether it belongs to core or to a module
- verify whether club/module gating affects the behavior
- verify user role and team scope
- keep the change server-rendered
- prefer service-layer logic for aggregations/calculations
- add or update Jest/Supertest coverage

## 19. Recommended prompt prefix for another AI

If you want to pass this project to another AI, this condensed instruction works well:

`You are working on SoccerProcessIQ Suite, a Node.js + Express + EJS + MySQL football academy management monolith. The app is server-rendered, module-aware by club, and must evolve incrementally without React/Vue/TypeScript/Prisma/GraphQL. Core areas are clubs, teams, players, reports, evaluations, planning, and rival scouting. Respect active club context, role/team scope, and module flags (scouting_players, planning, scouting_teams). Put business logic in services, not EJS. Add Jest/Supertest coverage for new routes and avoid rewrites.`

## 20. Files another AI should inspect first

If deeper code changes are needed, inspect these files first:

- `src/app.js`
- `src/initDb.js`
- `src/core/routes/index.js`
- `src/middleware/sessionContext.js`
- `src/middleware/moduleMiddleware.js`
- `src/shared/services/clubModuleService.js`
- `src/services/userScopeService.js`
- `src/controllers/dashboardController.js`
- `src/controllers/teamController.js`
- `src/controllers/playerProfileController.js`
- `src/controllers/evaluationController.js`
- `src/routes/reportRoutes.js`
- `src/routes/evaluationRoutes.js`
- `src/modules/planning/routes/index.js`
- `src/modules/scoutingTeams/routes/index.js`
- `tests/app.test.js`

## 21. Bottom line

This project is a practical, evolving football operations monolith with:

- a strong SSR requirement
- club-scoped module activation
- a mixed legacy + modular codebase shape
- a real operational access model
- evaluations and player workflows as a core value area
- planning and scouting teams as expanding modules

The safest way to work in this codebase is to make focused, incremental changes that respect context, scope, and module activation.
