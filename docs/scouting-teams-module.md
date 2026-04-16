# Scouting Teams module

## Objetivo

Integrar un MVP funcional de scouting de equipos y rivales dentro de `spi-scouting-web`, reutilizando solo el valor de dominio de `spi-opponent-scouting-web` y apoyándose en el core común del repo principal.

## Qué se reutilizó del repo secundario

Se reutilizó el criterio de dominio, no su stack ni su shell de aplicación:

- la idea de `opponents` como entidad estable reutilizable
- la idea de `scouting_reports` como artefacto central de observación
- la separación conceptual de análisis táctico y conclusiones
- la organización del contenido alrededor de:
  - sistema base
  - fase con balón
  - fase sin balón
  - transiciones
  - balón parado
  - fortalezas / debilidades
  - jugadores clave
  - observaciones generales

## Qué se descartó

No se migró tal cual desde `spi-opponent-scouting-web`:

- frontend React/Vite/TypeScript
- router SPA y shell de aplicación propia
- API client, React Query y formularios hook-based
- backend modular TypeScript del repo secundario
- auth, navegación, layout y configuración global duplicados
- versionado/publicación avanzada del informe
- editor por secciones desacopladas en múltiples endpoints

## Qué se reescribió/adaptó

Para encajar con `spi-scouting-web` se reescribió en Express/EJS/MySQL:

- tablas `scouting_team_opponents` y `scouting_team_reports`
- acceso a datos del módulo
- servicio de resolución/creación de rival por club
- controlador SSR
- rutas integradas bajo `/scouting-teams`
- vistas EJS para:
  - listado
  - creación
  - edición
  - detalle
- protección por `requireModule('scouting_teams')`

## Modelo implementado en el MVP

### scouting_team_opponents

Entidad estable por club para no repetir rivales constantemente.

Campos principales:

- `id`
- `club_id`
- `name`
- `country_name`
- `created_at`
- `updated_at`

### scouting_team_reports

Informe operativo de scouting integrado con el core común.

Campos principales:

- `id`
- `club_id`
- `own_team_id`
- `opponent_id`
- `created_by`
- `match_date`
- `competition`
- `system_shape`
- `style_in_possession`
- `style_out_of_possession`
- `transitions`
- `set_pieces`
- `strengths`
- `weaknesses`
- `key_players`
- `general_observations`
- `created_at`
- `updated_at`

## Integración con el core

El módulo usa:

- autenticación y sesión existentes
- club activo del usuario
- equipos del club desde `teams`
- layout, sidebar, dashboard y flash messages existentes
- sistema de módulos por club

No introduce miniapp separada.

## Permisos aplicados

Se mantiene el sistema de roles existente del repo principal y no se crea un ACL paralelo.

- `user`
  - puede listar y ver informes del club
  - puede crear informes nuevos
  - puede editar únicamente los informes creados por ese mismo usuario
  - no puede borrar informes
- `admin`
  - puede listar, ver, crear, editar y borrar cualquier informe del club
- `superadmin`
  - mantiene capacidad completa de gestión, reutilizando el mismo core y el club activo seleccionado

Esta estrategia permite trabajo operativo de analistas sin duplicar roles ni arrastrar complejidad prematura.

## Gestión de módulos por club

La configuración del club ya permite:

- activar o desactivar módulos manualmente
- aplicar presets rápidos de activación
- ver estado activo/inactivo por módulo
- consultar ruta principal y resumen de acceso previsto por rol

Los presets actuales son:

- `Core operativo`
- `Análisis deportivo`
- `Suite completa`

## Deuda pendiente

- filtros más completos en listado
- catálogo de competiciones
- estados del informe (`draft`, `published`)
- sistema/estructura rival más rico
- secciones avanzadas tipo forma reciente, análisis por fases y DAFO relacional
- permisos más finos si en el futuro se añade un rol específico de analista o workflow de publicación
