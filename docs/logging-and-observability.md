# Logging y observabilidad

La aplicación dispone ahora de logging estructurado en JSON con niveles configurables por entorno.

## Objetivos cubiertos

- logs activables por nivel: `error`, `warn`, `info`, `debug`
- trazabilidad de peticiones HTTP
- auditoría básica de autenticación
- logs fáciles de guardar en fichero
- formato compatible con Loki/Grafana sin reescribir la app

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
- `GET` normales -> `debug`

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

## Recomendación operativa

Empieza así:

1. activar `LOG_FILE_PATH`
2. dejar `LOG_LEVEL=info` en producción
3. usar `debug` solo temporalmente
4. revisar una semana qué ruido generan los logs
5. después conectar ese fichero a Loki/Grafana

## Siguiente ampliación recomendada

Si más adelante quieres más visibilidad, los siguientes eventos útiles para auditar son:

- creación, edición y borrado de jugadores
- creación, edición y borrado de informes
- creación de evaluaciones
- cambios de usuario y roles
- cambios de configuración de club

La base actual ya está preparada para seguir creciendo sobre el mismo logger.
