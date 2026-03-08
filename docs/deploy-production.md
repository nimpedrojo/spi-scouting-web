# Despliegue a producción sin perder datos

Esta guía está pensada para el stack actual del proyecto:

- Node.js
- Express
- EJS
- MySQL
- VPS sin contenedores

La aplicación inicializa tablas en el arranque mediante `src/initDb.js`. Eso permite crear tablas nuevas si no existen, pero no sustituye una estrategia segura de despliegue. El objetivo de este procedimiento es actualizar código sin romper los datos ya existentes.

## Caso específico: producción existente en `080ad37`

Si la producción actual está en el commit `080ad37` y quieres subir a la versión actual (`b0e41da` en el momento de redactar esta guía), no lo trates como un primer despliegue.

Ese salto incluye varios cambios funcionales y estructurales:

- `4bce61e` Base estructural v2 + layout + Plantillas
- `475f090` Evaluaciones completas + importación Excel
- `4c0bfe3` Ficha avanzada de jugador + analítica + dashboard
- `b154924` Comparador avanzado de jugadores
- `226bb02` Plantillas de evaluación configurables
- `adaef6c` Comparativa 26/27
- `51d058f` Previsión 26/27
- `b0e41da` PDF avanzado de jugador / informe trimestral

En otras palabras: el cambio no es cosmético. Introduce tablas nuevas, nuevas relaciones, nuevos servicios y sincronizaciones automáticas al arrancar.

### Riesgos concretos de este upgrade

1. La tabla `users` recibe columnas nuevas y claves foráneas nuevas.
2. El arranque ejecuta `syncUserClubAssignments()`, que rellena `users.club_id` a partir de `users.default_club`.
3. El arranque ejecuta `ensureAdminUser()`, que puede crear un `superadmin` por defecto si el email configurado no existe.
4. Se crean nuevas tablas: `seasons`, `sections`, `categories`, `teams`, `team_players`, `evaluations`, `evaluation_scores`, `evaluation_templates`, `evaluation_template_metrics`.
5. Parte de la aplicación nueva asume relación más estricta entre club, temporada, equipo y usuario.

Por eso, el despliegue correcto es un upgrade controlado sobre copia real de producción antes de tocar la base viva.

## Principios

1. No desplegar directamente sobre la carpeta en uso.
2. Hacer backup de la base de datos antes de cada release.
3. Mantener el archivo `.env` fuera de cada release.
4. Desplegar primero en una carpeta nueva y activar después.
5. Tener rollback inmediato al release anterior.
6. Evitar cambios destructivos de base de datos en el mismo despliegue.

## Estructura recomendada en el VPS

```text
/var/www/soccer_report/
  releases/
    20260308-120000/
    20260310-091500/
  shared/
    .env
    logs/
    backups/
  current -> /var/www/soccer_report/releases/20260310-091500
```

`current` será un symlink al release activo.

## Variables y requisitos previos

Antes del primer despliegue, valida:

- Node.js LTS instalado
- MySQL accesible desde el VPS
- usuario de MySQL con permisos sobre la base de datos
- `SESSION_SECRET` largo y único
- `NODE_ENV=production`
- proxy inverso configurado si usas Nginx

Ejemplo de `shared/.env`:

```dotenv
NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=soccer_report_user
DB_PASSWORD=tu_password_seguro
DB_NAME=soccer_report
SESSION_SECRET=una_cadena_larga_unica_y_privada
```

## Checklist antes de desplegar

1. Tener commit identificado para desplegar.
2. Ejecutar tests en local o staging:
   `npm test`
3. Revisar que no haya cambios destructivos en tablas o columnas.
4. Confirmar espacio libre suficiente para backup y nuevo release.
5. Confirmar acceso a MySQL y credenciales actuales.

## Checklist adicional para upgrade desde `080ad37`

1. Identificar el commit exacto que corre hoy en producción.
2. Exportar no solo backup de datos, también el esquema actual.
3. Crear una base clonada de staging a partir de producción.
4. Arrancar la versión nueva contra esa clonación.
5. Validar especialmente:
   - login con usuarios existentes
   - usuarios con `default_club`
   - listados de jugadores existentes
   - informes existentes
   - acceso admin y no admin
6. Confirmar que el arranque no crea usuarios admin inesperados.
7. Confirmar que `users.club_id` se rellena correctamente y no deja registros inconsistentes.

## Backup de producción

Haz backup siempre antes de tocar el servicio.

```bash
mkdir -p /var/www/soccer_report/shared/backups
mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  -h 127.0.0.1 \
  -u soccer_report_user \
  -p soccer_report \
  > /var/www/soccer_report/shared/backups/soccer_report-$(date +%F-%H%M%S).sql
```

Verifica que el archivo se ha creado y no está vacío:

```bash
ls -lh /var/www/soccer_report/shared/backups
```

Si guardas archivos subidos por usuarios fuera de la base de datos, respáldalos también.

Guarda también una exportación del esquema para inspección rápida:

```bash
mysqldump \
  --no-data \
  -h 127.0.0.1 \
  -u soccer_report_user \
  -p soccer_report \
  > /var/www/soccer_report/shared/backups/soccer_report-schema-$(date +%F-%H%M%S).sql
```

## Upgrade previo en staging con copia real

Antes de desplegar en producción, crea una base clonada desde la real.

### 1. Crear base clonada

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS soccer_report_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p soccer_report_staging < /var/www/soccer_report/shared/backups/soccer_report-AAAA-MM-DD-HHMMSS.sql
```

### 2. Preparar `.env` de staging

```dotenv
NODE_ENV=production
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=soccer_report_user
DB_PASSWORD=tu_password_seguro
DB_NAME=soccer_report_staging
SESSION_SECRET=staging_secret_largo
ADMIN_EMAIL=no-crear-admin@local
ADMIN_PASSWORD=deshabilitado
```

Nota importante:

- usa un `ADMIN_EMAIL` que ya sepas controlar
- así detectas si `ensureAdminUser()` crea una cuenta nueva en staging
- si eso ocurre en staging, en producción debes decidir explícitamente si lo quieres o no

### 3. Arrancar la versión nueva contra la copia

```bash
cd /var/www/soccer_report/releases/<release-staging>
cp /ruta/a/.env.staging .env
npm ci --omit=dev
node src/server.js
```

### 4. Qué validar en staging

1. login con un usuario histórico real
2. login con admin real existente
3. listado de jugadores e informes ya existentes
4. creación de equipo nuevo en Plantillas
5. apertura de dashboard
6. apertura de evaluaciones
7. apertura de plantillas de evaluación
8. revisión de tabla `users` antes y después del arranque

Consulta útil:

```sql
SELECT id, name, email, role, default_club, club_id, default_team, default_team_id
FROM users
ORDER BY id;
```

Si staging falla aquí, no pases a producción.

## Procedimiento de despliegue

### 1. Crear nuevo release

```bash
export APP_ROOT=/var/www/soccer_report
export RELEASE_ID=$(date +%Y%m%d-%H%M%S)
export RELEASE_PATH=$APP_ROOT/releases/$RELEASE_ID

mkdir -p "$RELEASE_PATH"
git clone /ruta/al/repositorio.git "$RELEASE_PATH"
cd "$RELEASE_PATH"
git checkout <commit-o-tag-a-desplegar>
```

Si en el VPS ya tienes un clon persistente del repo, también puedes usar:

```bash
git fetch --all --tags
git checkout <commit-o-tag-a-desplegar>
```

### 2. Instalar dependencias

```bash
cd "$RELEASE_PATH"
npm ci --omit=dev
```

Si en producción ejecutas tests o validaciones más completas, usa `npm ci` sin `--omit=dev`.

### 3. Enlazar configuración compartida

```bash
ln -sfn "$APP_ROOT/shared/.env" "$RELEASE_PATH/.env"
mkdir -p "$APP_ROOT/shared/logs"
```

### 4. Validar arranque antes de activar

La app crea tablas en el arranque con `initDatabaseOnce()`, así que una comprobación mínima útil es:

```bash
cd "$RELEASE_PATH"
node -e "require('./src/initDb').initializeDatabase().then(() => { console.log('DB OK'); process.exit(0); }).catch((err) => { console.error(err); process.exit(1); })"
```

Si este paso falla, no cambies el release activo.

Para upgrade desde `080ad37`, añade esta comprobación SQL antes de activar:

```bash
mysql -h 127.0.0.1 -u soccer_report_user -p -D soccer_report -e "
SHOW TABLES;
SELECT COUNT(*) AS total_users FROM users;
SELECT COUNT(*) AS total_clubs FROM clubs;
SELECT COUNT(*) AS total_players FROM players;
SELECT COUNT(*) AS total_reports FROM reports;
"
```

La idea no es validar toda la lógica, sino detectar rápidamente una rotura de datos obvia.

### 5. Activar el release

```bash
ln -sfn "$RELEASE_PATH" "$APP_ROOT/current"
```

### 6. Reiniciar el servicio

#### Opción recomendada: `systemd`

Archivo sugerido:

`/etc/systemd/system/soccer-report.service`

```ini
[Unit]
Description=SoccerReport
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/soccer_report/current
EnvironmentFile=/var/www/soccer_report/shared/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Comandos:

```bash
sudo systemctl daemon-reload
sudo systemctl restart soccer-report
sudo systemctl status soccer-report --no-pager
```

#### Alternativa: `pm2`

```bash
cd /var/www/soccer_report/current
pm2 start src/server.js --name soccer-report --update-env
pm2 save
```

En siguientes despliegues:

```bash
cd /var/www/soccer_report/current
pm2 restart soccer-report --update-env
```

## Smoke test después del despliegue

Haz estas comprobaciones justo después del reinicio:

1. `curl -I http://127.0.0.1:3000/`
2. acceso a login
3. login con usuario admin
4. dashboard carga correctamente
5. navegación a:
   - `/teams`
   - `/reports`
   - `/evaluations`
   - `/evaluation-templates`
6. crear o editar una entidad no crítica de prueba
7. revisar logs del servicio

Para este salto concreto, añade:

8. revisar que los usuarios existentes siguen entrando
9. revisar que ningún usuario perdió club por defecto
10. revisar que los informes históricos siguen visibles
11. revisar que no se ha creado un superadmin inesperado

Con `systemd`:

```bash
sudo journalctl -u soccer-report -n 100 --no-pager
```

Con `pm2`:

```bash
pm2 logs soccer-report --lines 100
```

## Rollback

Si el código nuevo falla pero la base de datos no ha sufrido cambios destructivos, el rollback debe ser solo de código.

1. identificar el release anterior
2. volver a apuntar `current`
3. reiniciar el servicio

Ejemplo:

```bash
ln -sfn /var/www/soccer_report/releases/20260308-120000 /var/www/soccer_report/current
sudo systemctl restart soccer-report
```

Verifica inmediatamente:

```bash
sudo systemctl status soccer-report --no-pager
```

Solo restaura la base de datos desde backup si el problema ha dañado datos o una migración destructiva los ha dejado incompatibles.

En este upgrade concreto, el rollback preferido es:

1. rollback de código inmediato
2. inspección de cambios en `users`
3. restauración de base de datos solo si el arranque modificó datos de forma incorrecta

## Reglas para cambios de base de datos

En este proyecto conviene seguir estas reglas:

1. Añadir tablas nuevas con `CREATE TABLE IF NOT EXISTS`.
2. Añadir columnas nuevas como `NULL` o con default seguro.
3. No borrar columnas en el mismo release en que dejas de usarlas.
4. No renombrar columnas críticas sin una fase de compatibilidad.
5. Si una tabla nueva depende de otra, validar claves foráneas en staging antes de producción.

## Plan recomendado para tu caso

Si tu producción está realmente en `080ad37`, el orden que yo seguiría es este:

1. sacar dump completo de producción
2. clonar producción a una base staging
3. arrancar `b0e41da` contra esa copia
4. validar usuarios, clubes, jugadores e informes existentes
5. revisar cambios automáticos en `users`
6. preparar release en VPS
7. parar tráfico o desplegar en ventana de baja actividad
8. backup final justo antes del switch
9. activar release
10. reiniciar servicio
11. smoke test funcional
12. monitorizar logs
13. si algo falla, rollback de código en minutos

## Orden recomendado por release

1. backup de base de datos
2. crear release nuevo
3. `npm ci --omit=dev`
4. enlazar `.env`
5. validar `initializeDatabase()`
6. activar symlink `current`
7. reiniciar servicio
8. smoke test
9. monitorizar logs 10-15 minutos

## Qué no hacer

- no hacer `git pull` directamente sobre la carpeta viva
- no editar `.env` dentro del release
- no desplegar sin backup
- no ejecutar cambios destructivos de MySQL sin ventana de mantenimiento
- no borrar releases anteriores hasta validar el nuevo

## Recomendación operativa

Si hoy no tienes nada montado, usa `systemd` para el proceso Node y Nginx como proxy inverso. Es la opción más estable y simple para este proyecto.
