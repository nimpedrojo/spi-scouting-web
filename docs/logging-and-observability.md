# Logging y observabilidad

La aplicación dispone ahora de logging estructurado en JSON con niveles configurables por entorno.

## Objetivos cubiertos

- logs activables por nivel: `error`, `warn`, `info`, `debug`
- trazabilidad de peticiones HTTP
- auditoría de autenticación y eventos de negocio
- logs fáciles de guardar en fichero
- formato compatible con Loki/Grafana sin reescribir la app

## Tipos de log emitidos

- `http_request`: tráfico HTTP general
- `page_view`: navegación HTML útil para analizar uso real
- `auth`: login, logout, registro y errores de cuenta
- `audit`: acciones de negocio sobre entidades

## Variables de entorno

```dotenv
LOG_LEVEL=info
LOG_FILE_PATH=./logs/app.log
APP_NAME=soccer_report
```

### Niveles

- `error`: solo errores
- `warn`: errores y avisos
- `info`: errores, avisos y eventos normales importantes
- `debug`: todo lo anterior más peticiones GET normales

## Qué se está registrando

### Peticiones HTTP

Cada request genera un log con:

- método
- ruta
- código de estado
- duración
- IP
- user-agent
- usuario autenticado si existe
- club y temporada en sesión si existen

Comportamiento por nivel:

- errores `5xx` -> `error`
- operaciones no `GET` y respuestas `4xx` -> `info`
- `GET` no HTML -> `debug`

### Navegación de páginas

Las páginas HTML relevantes se registran como `page_view` en nivel `info`.

Esto permite explotar:

- páginas más visitadas
- uso por usuario
- uso por club
- vistas de detalle más abiertas
- pantallas de creación/edición más utilizadas

Ejemplos actuales:

- `players_list`
- `player_new_form`
- `player_edit_form`
- `teams_index`
- `team_detail`
- `reports_list`
- `report_detail`
- `report_new_form`
- `evaluation_new_form`
- `evaluations_compare`
- `evaluation_templates_list`

### Autenticación y cuenta

Se registran:

- login correcto
- login fallido por usuario inexistente
- login fallido por contraseña incorrecta
- logout
- registro de usuario
- actualización de cuenta
- errores de autenticación o cuenta

### Contexto de sesión

Si falla la resolución del club o temporada activa del usuario, se registra un error estructurado.

### Auditoría de negocio

Se registran eventos `audit` en operaciones como:

- creación, edición, borrado y borrado múltiple de jugadores
- importación de jugadores
- creación, edición, borrado y borrado múltiple de informes
- creación, edición y borrado de plantillas
- creación e importación de evaluaciones
- comparativas de evaluaciones
- creación, edición y borrado de equipos

Cada evento incluye, cuando aplica:

- `action`
- `entity`
- `userId`
- `userEmail`
- `userRole`
- `clubId`
- `seasonId`
- `ip`
- identificadores o contadores específicos de la operación

## Dónde se generan

- consola `stdout/stderr`
- fichero opcional si `LOG_FILE_PATH` está definido

## Uso local

```bash
LOG_LEVEL=debug npm run dev
```

## Uso en producción

Recomendación mínima:

```dotenv
NODE_ENV=production
LOG_LEVEL=info
LOG_FILE_PATH=/var/www/soccer_report/shared/logs/app.log
```

Para investigar un problema puntual:

```dotenv
LOG_LEVEL=debug
```

Luego reinicia el servicio y vuelve a `info` cuando termines.

## Consulta simple sin Grafana

Como el formato es JSON por línea, puedes consultar con herramientas de shell:

```bash
tail -f /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"level":"error"' /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"type":"auth"' /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"type":"page_view"' /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"type":"audit"' /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"entity":"player"' /var/www/soccer_report/shared/logs/app.log
```

```bash
rg '"page":"report_detail"' /var/www/soccer_report/shared/logs/app.log
```

## Opción sencilla tipo Grafana

La opción más simple y razonable para este proyecto es:

- aplicación escribe JSON logs a fichero
- `promtail` lee ese fichero
- `Loki` almacena los logs
- `Grafana` consulta y visualiza

Ventajas:

- muy poco acoplamiento con la app
- no obliga a meter una base de datos extra para logs
- funciona bien con VPS y proyectos pequeños
- permite filtrar por nivel, ruta, usuario o tipo de evento

## Conjunto recomendado para explotar información

Con el esquema actual ya puedes responder preguntas como:

- qué módulos usan más los entrenadores
- cuántas veces se abre una ficha de jugador
- qué usuarios crean más informes o evaluaciones
- qué clubes usan más cada pantalla
- qué importaciones generan más incidencias
- qué operaciones administrativas ocurren más a menudo

Si luego montas paneles en Grafana, los primeros que haría son:

1. páginas vistas por día (`type=page_view`)
2. actividad por usuario (`userEmail`)
3. acciones de negocio por entidad (`type=audit`, `entity`)
4. errores por ruta (`level=error`, `path`)
5. tiempos de respuesta (`type=http_request`, `durationMs`)

## Recomendación operativa

Empieza así:

1. activar `LOG_FILE_PATH`
2. dejar `LOG_LEVEL=info` en producción
3. usar `debug` solo temporalmente
4. revisar una semana qué ruido generan los logs
5. después conectar ese fichero a Loki/Grafana

## Siguiente ampliación recomendada

Si más adelante quieres todavía más granularidad, el siguiente bloque lógico es:

- cambios de usuarios y roles
- cambios de configuración de club
- accesos a dashboard y comparativas con filtros completos
- exportaciones CSV/Excel/PDF

La base actual ya está preparada para seguir creciendo sobre el mismo logger.
