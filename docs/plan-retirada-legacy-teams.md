# Plan de retirada de compatibilidad legacy de equipos

## Objetivo

Eliminar la compatibilidad temporal con:

- tabla `club_teams`
- campo textual `players.team` como fuente operativa
- campo textual `users.default_team` como fallback operativo

sin romper:

- informes scouting
- gestión de jugadores
- gestión de usuarios
- configuración de club
- dashboard y analítica
- evaluaciones y filtros por equipo

La migración debe ser incremental y reversible por fases.

---

## Estado actual

Hoy conviven dos modelos:

### Modelo legacy

- equipos guardados en `club_teams`
- jugadores con equipo textual en `players.team`
- usuarios con equipo por defecto textual en `users.default_team`
- algunos flujos operativos resuelven club/equipo por nombre

### Modelo v2

- equipos en `teams`
- relación de jugador con equipo en `players.current_team_id`
- relación ampliada en `team_players`
- equipo por defecto de usuario en `users.default_team_id`

Mientras existan fallbacks a texto, no es seguro retirar `legacy`.

---

## Criterio de salida final

La opción legacy solo se podrá eliminar cuando se cumplan todas estas condiciones:

1. `club_teams` no contiene datos activos.
2. Ningún jugador operativo depende de `players.team`.
3. Ningún usuario depende de `users.default_team`.
4. El flujo de informes no usa `default_team` textual para precargar ni filtrar.
5. La pantalla de configuración de club no muestra ni gestiona equipos legacy.
6. Los tests de compatibilidad legacy se han sustituido por tests v2.

---

## Fase 0. Auditoría y fotografía

### Objetivo

Saber exactamente cuánto legado queda y dónde.

### Consultas recomendadas

```sql
SELECT COUNT(*) AS total_legacy_teams
FROM club_teams;

SELECT COUNT(*) AS players_without_current_team_but_with_legacy_team
FROM players
WHERE current_team_id IS NULL
  AND team IS NOT NULL
  AND TRIM(team) <> '';

SELECT COUNT(*) AS users_without_default_team_id_but_with_legacy_team
FROM users
WHERE default_team_id IS NULL
  AND default_team IS NOT NULL
  AND TRIM(default_team) <> '';

SELECT COUNT(*) AS users_without_club_id_but_with_default_club
FROM users
WHERE club_id IS NULL
  AND default_club IS NOT NULL
  AND TRIM(default_club) <> '';
```

### Resultado esperado

Un inventario con:

- clubes con equipos legacy
- jugadores no migrados a `current_team_id`
- usuarios no migrados a `default_team_id`
- código que aún depende de campos legacy

### Bloqueadores

- si hay muchos jugadores sin `current_team_id`
- si hay usuarios con `default_team` pero sin equivalente en `teams`
- si existen equipos legacy sin correspondencia clara en v2

---

## Fase 1. Congelar la creación de nuevo legado

### Objetivo

Evitar que siga creciendo la deuda legacy.

### Cambios

1. Deshabilitar el alta/edición/borrado de `club_teams` en `/admin/club`.
2. Dejar la sección legacy solo en modo lectura temporal.
3. Obligar a que todos los nuevos equipos se creen únicamente desde `Plantillas v2`.
4. Asegurar que nuevos usuarios solo guardan `default_team_id`.
5. Asegurar que nuevos jugadores se vinculan a `current_team_id` cuando se asigna equipo.

### Archivos afectados

- `src/routes/clubConfigRoutes.js`
- `src/models/clubTeamModel.js`
- `src/views/club/config.ejs`
- `src/routes/userAdminRoutes.js`
- `src/routes/playerAdminRoutes.js`
- `src/services/playerAdminService.js`

### Criterio de aceptación

- no se puede crear nuevo equipo legacy desde la UI
- todos los equipos nuevos viven en `teams`
- no se generan más usuarios con `default_team` textual

---

## Fase 2. Migración de datos

### Objetivo

Mover todos los datos operativos al modelo v2.

### 2.1 Migrar equipos legacy a `teams`

Para cada fila de `club_teams`:

1. localizar el club en `clubs`
2. asignar una temporada activa
3. asignar sección/categoría válidas
4. crear un equipo v2 equivalente en `teams`

Si no hay suficiente contexto para sección/categoría/temporada:

- crear un proceso asistido
- o marcar esos casos como pendientes de decisión manual

### 2.2 Migrar jugadores

Para cada jugador con `players.team` y sin `current_team_id`:

1. buscar equipo v2 equivalente dentro del mismo club
2. rellenar `current_team_id`
3. crear relación en `team_players` si falta

### 2.3 Migrar usuarios

Para cada usuario con `default_team` y sin `default_team_id`:

1. buscar el equipo v2 equivalente dentro de su club
2. rellenar `default_team_id`
3. dejar `default_team` como sombra temporal hasta el corte final

### Script recomendado

Crear un script específico, por ejemplo:

`scripts/migrate_legacy_teams_to_v2.js`

Responsabilidades del script:

- detectar equivalencias automáticas
- producir log de casos ambiguos
- no sobrescribir relaciones correctas
- permitir ejecución repetible

### Reglas de seguridad

- no borrar nada en esta fase
- no tocar registros ambiguos sin log
- registrar conteos antes y después

### Criterio de aceptación

```sql
SELECT COUNT(*) AS pending_players
FROM players
WHERE current_team_id IS NULL
  AND team IS NOT NULL
  AND TRIM(team) <> '';

SELECT COUNT(*) AS pending_users
FROM users
WHERE default_team_id IS NULL
  AND default_team IS NOT NULL
  AND TRIM(default_team) <> '';
```

Ambas consultas deben devolver `0`.

---

## Fase 3. Desacoplar el código de los fallbacks legacy

### Objetivo

Que el sistema funcione al 100% solo con el modelo v2 aunque aún no se hayan borrado columnas/tablas antiguas.

### 3.1 Jugadores

Eliminar dependencia operativa de:

- `players.team`
- `COALESCE(t.name, p.team)`

Sustituir por:

- `current_team_id`
- joins a `teams`
- `team_players`

### Zonas a revisar

- `src/models/playerModel.js`
- `src/services/playerAnalyticsService.js`
- `src/models/teamPlayerModel.js`

### 3.2 Usuarios

Eliminar dependencia operativa de:

- `users.default_team`

Mantener solo:

- `users.default_team_id`

Y usar `teams.name` solo como dato derivado de visualización.

### Zonas a revisar

- `src/models/userModel.js`
- `src/views/users/form.ejs`
- `src/views/auth/account.ejs`

### 3.3 Informes scouting

Este es el punto más delicado.

Hoy el flujo nuevo informe usa:

- `default_club`
- `default_team`
- búsqueda de jugadores por nombre de equipo

Debe pasar a usar:

- `club_id` o club resuelto
- `default_team_id`
- búsqueda por relación con `teams.id`

### Zonas a revisar

- `src/routes/reportRoutes.js`
- `src/models/playerModel.js`
- `src/views/reports/new.ejs`

### 3.4 Configuración de club

Eliminar:

- lectura de `legacyTeams`
- tabla “Compatibilidad legacy”
- operaciones CRUD sobre `club_teams`

### Zonas a revisar

- `src/services/clubAdminService.js`
- `src/routes/clubConfigRoutes.js`
- `src/views/club/config.ejs`

### Criterio de aceptación

- la app funciona con `club_teams` vacía
- no hay rutas que lean `default_team` como dato operativo
- no hay consultas funcionales que dependan de `players.team`

---

## Fase 4. Limpieza funcional y visual

### Objetivo

Retirar la opción legacy de la experiencia de usuario.

### Cambios

1. Eliminar la sección “Compatibilidad legacy” de configuración de club.
2. Eliminar referencias en textos, ayudas y documentación.
3. Eliminar tests que validan legacy.
4. Añadir tests que validen exclusivamente el comportamiento v2.

### Tests a sustituir

Especialmente revisar:

- `tests/app.test.js`
- test de “compatibilidad legacy”
- tests que aceptan `default_team` textual

### Criterio de aceptación

- no hay ninguna pantalla visible con el término `legacy`
- todos los tests funcionales describen solo el modelo v2

---

## Fase 5. Limpieza de base de datos

### Objetivo

Borrar estructuras legacy solo cuando ya no se usan.

### Borrado final

1. eliminar tabla `club_teams`
2. eliminar columna `users.default_team` si ya no se usa
3. evaluar eliminación de `players.team` o mantenerla solo como histórico

### Recomendación importante

No eliminar `players.team` inmediatamente si todavía aporta valor histórico o para debugging.

Estrategia recomendada:

1. primero dejar de leerla
2. después dejar de escribirla
3. más adelante decidir si se borra o se conserva como snapshot histórico

### Orden recomendado

1. borrar `club_teams`
2. borrar referencias de código
3. borrar `users.default_team`
4. decidir el futuro de `players.team`

---

## Riesgos principales

### Riesgo 1. Emparejamiento ambiguo de equipos

Un mismo nombre puede existir en distintas temporadas o categorías.

Mitigación:

- no migrar automáticamente casos ambiguos
- generar informe de revisión manual

### Riesgo 2. Informes scouting sin equipo relacional

El módulo de informes es el más expuesto a romperse porque todavía opera por nombre.

Mitigación:

- migrar primero defaults de usuario
- luego adaptar `reportRoutes`
- después eliminar fallback textual

### Riesgo 3. Filtros administrativos por `default_club`

Todavía hay partes del sistema que comparan por nombre y no por `club_id`.

Mitigación:

- consolidar filtrado administrativo por `club_id`
- dejar `default_club` solo como dato de contexto/visualización

---

## Recomendación de ejecución

Orden recomendado de implementación:

1. congelar creación de legacy
2. script de migración de datos
3. adaptar informes y jugadores a v2 puro
4. retirar UI legacy
5. limpiar tests y docs
6. borrar tabla/campos finales

No conviene hacerlo en un único cambio grande.

Lo más seguro es repartirlo en 3 PRs:

### PR 1

- congelación de legacy
- auditoría
- script de migración

### PR 2

- adaptación del código a v2 puro
- informes, jugadores, usuarios, configuración de club

### PR 3

- borrado de UI legacy
- borrado de tests legacy
- limpieza final de esquema

---

## Checklist final de retirada

- `club_teams` vacía
- `players` sin registros operativos apoyados en `team`
- `users` sin registros apoyados en `default_team`
- informes funcionando con `default_team_id`
- configuración de club sin módulo legacy
- tests verdes sin referencias legacy
- documentación actualizada

Si cualquiera de estos puntos no se cumple, no conviene retirar todavía la compatibilidad legacy.
