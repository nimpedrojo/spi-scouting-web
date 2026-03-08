# Runbook de upgrade: `080ad37` -> `b0e41da`

Este documento describe un procedimiento operativo para actualizar una instalación de producción ya existente de SoccerReport desde el commit `080ad37` hasta `b0e41da` sin perder los datos actuales.

Está pensado para:

- VPS Linux
- MySQL local o accesible por red privada
- Node.js ejecutado con `systemd` o `pm2`
- aplicación ya en producción con usuarios reales

## Resumen ejecutivo

No hagas el upgrade directamente sobre la base de producción.

El orden correcto es:

1. backup completo de producción
2. clonado de producción a staging
3. arranque de `b0e41da` sobre staging
4. validación funcional con datos reales clonados
5. despliegue de código en producción
6. smoke test
7. rollback inmediato si algo falla

## Variables a completar

Sustituye estos valores antes de ejecutar nada:

```bash
export APP_NAME="soccer-report"
export APP_ROOT="/var/www/soccer_report"
export REPO_URL="git@github.com:TU_ORG/TU_REPO.git"
export PROD_DB_HOST="127.0.0.1"
export PROD_DB_PORT="3306"
export PROD_DB_NAME="soccer_report"
export PROD_DB_USER="soccer_report_user"
export STAGING_DB_NAME="soccer_report_staging"
export TARGET_COMMIT="b0e41da"
export SOURCE_COMMIT="080ad37"
```

## Fase 0: comprobaciones previas

### 0.1 Confirmar versión actual en producción

En el servidor de producción:

```bash
cd "$APP_ROOT/current"
git rev-parse --short HEAD
```

Debe devolver:

```bash
080ad37
```

Si devuelve otra cosa, para y ajusta este runbook.

### 0.2 Confirmar versión objetivo

```bash
git rev-parse --short "$TARGET_COMMIT"
```

Debe resolver a:

```bash
b0e41da
```

### 0.3 Revisar que tienes acceso a MySQL

```bash
mysql -h "$PROD_DB_HOST" -P "$PROD_DB_PORT" -u "$PROD_DB_USER" -p -e "SHOW DATABASES;"
```

## Fase 1: backup obligatorio

### 1.1 Crear carpeta de backups

```bash
mkdir -p "$APP_ROOT/shared/backups"
```

### 1.2 Dump completo de producción

```bash
mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  -h "$PROD_DB_HOST" \
  -P "$PROD_DB_PORT" \
  -u "$PROD_DB_USER" \
  -p "$PROD_DB_NAME" \
  > "$APP_ROOT/shared/backups/${PROD_DB_NAME}-$(date +%F-%H%M%S).sql"
```

### 1.3 Dump solo de esquema

```bash
mysqldump \
  --no-data \
  -h "$PROD_DB_HOST" \
  -P "$PROD_DB_PORT" \
  -u "$PROD_DB_USER" \
  -p "$PROD_DB_NAME" \
  > "$APP_ROOT/shared/backups/${PROD_DB_NAME}-schema-$(date +%F-%H%M%S).sql"
```

### 1.4 Verificar backup

```bash
ls -lh "$APP_ROOT/shared/backups"
```

No continúes si el dump no existe o pesa sospechosamente poco.

## Fase 2: clonado a staging

### 2.1 Crear base de staging

```bash
mysql -u root -p -e "DROP DATABASE IF EXISTS ${STAGING_DB_NAME};"
mysql -u root -p -e "CREATE DATABASE ${STAGING_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 2.2 Restaurar el dump más reciente en staging

```bash
mysql -u root -p "$STAGING_DB_NAME" < "$APP_ROOT/shared/backups/${PROD_DB_NAME}-AAAA-MM-DD-HHMMSS.sql"
```

Sustituye el nombre real del dump.

### 2.3 Verificar datos mínimos en staging

```bash
mysql -u root -p -D "$STAGING_DB_NAME" -e "
SELECT COUNT(*) AS total_users FROM users;
SELECT COUNT(*) AS total_clubs FROM clubs;
SELECT COUNT(*) AS total_players FROM players;
SELECT COUNT(*) AS total_reports FROM reports;
"
```

Apunta esos valores. Luego los volverás a comparar.

## Fase 3: preparar release de staging

### 3.1 Crear release

```bash
export RELEASE_ID="staging-$(date +%Y%m%d-%H%M%S)"
export RELEASE_PATH="$APP_ROOT/releases/$RELEASE_ID"

mkdir -p "$RELEASE_PATH"
git clone "$REPO_URL" "$RELEASE_PATH"
cd "$RELEASE_PATH"
git checkout "$TARGET_COMMIT"
```

### 3.2 Instalar dependencias

```bash
cd "$RELEASE_PATH"
npm ci
```

### 3.3 Crear `.env` de staging

Archivo sugerido: `$APP_ROOT/shared/.env.staging-upgrade`

```dotenv
NODE_ENV=production
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=soccer_report_user
DB_PASSWORD=CAMBIAR
DB_NAME=soccer_report_staging
SESSION_SECRET=staging_upgrade_secret_muy_largo
ADMIN_EMAIL=upgrade-check@local
ADMIN_PASSWORD=no_usar_en_prod
```

Enlázalo:

```bash
ln -sfn "$APP_ROOT/shared/.env.staging-upgrade" "$RELEASE_PATH/.env"
```

## Fase 4: validación técnica sobre staging

### 4.1 Ejecutar inicialización de DB

```bash
cd "$RELEASE_PATH"
node -e "require('./src/initDb').initializeDatabase().then(() => { console.log('DB INIT OK'); process.exit(0); }).catch((err) => { console.error(err); process.exit(1); })"
```

Si esto falla, no sigas.

### 4.2 Verificar tablas nuevas

```bash
mysql -u root -p -D "$STAGING_DB_NAME" -e "
SHOW TABLES LIKE 'seasons';
SHOW TABLES LIKE 'sections';
SHOW TABLES LIKE 'categories';
SHOW TABLES LIKE 'teams';
SHOW TABLES LIKE 'team_players';
SHOW TABLES LIKE 'evaluations';
SHOW TABLES LIKE 'evaluation_scores';
SHOW TABLES LIKE 'evaluation_templates';
SHOW TABLES LIKE 'evaluation_template_metrics';
"
```

### 4.3 Verificar columnas nuevas en `users`

```bash
mysql -u root -p -D "$STAGING_DB_NAME" -e "
SHOW COLUMNS FROM users;
"
```

Confirma que existen:

- `role`
- `club_id`
- `default_club`
- `default_team`
- `default_team_id`

### 4.4 Revisar cambios automáticos en usuarios

```bash
mysql -u root -p -D "$STAGING_DB_NAME" -e "
SELECT id, name, email, role, default_club, club_id, default_team, default_team_id
FROM users
ORDER BY id;
"
```

Puntos a revisar:

- usuarios antiguos siguen existiendo
- no aparecen `club_id` absurdos
- `default_club` sigue intacto
- si aparece `upgrade-check@local`, es porque `ensureAdminUser()` ha creado un superadmin nuevo

Si se crea ese usuario en staging, no es necesariamente un error, pero debes decidir si en producción quieres permitirlo o prefieres configurar `ADMIN_EMAIL` con una cuenta ya existente.

### 4.5 Levantar la app en staging

```bash
cd "$RELEASE_PATH"
node src/server.js
```

Abre:

```text
http://TU_VPS:3001/login
```

### 4.6 Validación funcional en staging

Haz este recorrido con datos clonados:

1. login con usuario admin existente
2. login con usuario normal existente
3. dashboard
4. jugadores
5. informes existentes
6. plantillas
7. plantillas de evaluación
8. evaluaciones
9. ficha de jugador
10. logout

Si cualquier flujo base falla, para aquí.

## Fase 5: preparar release de producción

### 5.1 Crear release de producción

```bash
export RELEASE_ID=$(date +%Y%m%d-%H%M%S)
export RELEASE_PATH="$APP_ROOT/releases/$RELEASE_ID"

mkdir -p "$RELEASE_PATH"
git clone "$REPO_URL" "$RELEASE_PATH"
cd "$RELEASE_PATH"
git checkout "$TARGET_COMMIT"
npm ci --omit=dev
ln -sfn "$APP_ROOT/shared/.env" "$RELEASE_PATH/.env"
```

### 5.2 Validación previa de inicialización contra producción

Haz esto solo dentro de ventana de despliegue y con backup ya hecho:

```bash
cd "$RELEASE_PATH"
node -e "require('./src/initDb').initializeDatabase().then(() => { console.log('PROD DB INIT OK'); process.exit(0); }).catch((err) => { console.error(err); process.exit(1); })"
```

Si falla, cancela el deploy y no cambies `current`.

## Fase 6: despliegue en producción

### 6.1 Activar nuevo release

```bash
ln -sfn "$RELEASE_PATH" "$APP_ROOT/current"
```

### 6.2 Reiniciar servicio

Con `systemd`:

```bash
sudo systemctl restart soccer-report
sudo systemctl status soccer-report --no-pager
```

Con `pm2`:

```bash
cd "$APP_ROOT/current"
pm2 restart soccer-report --update-env
pm2 status
```

## Fase 7: smoke test en producción

### 7.1 Salud básica

```bash
curl -I http://127.0.0.1:3000/
```

### 7.2 Comprobaciones funcionales

Realiza estas validaciones manuales:

1. login con admin existente
2. login con usuario normal existente
3. dashboard carga
4. jugadores carga
5. informes históricos siguen visibles
6. acceso a `/teams`
7. acceso a `/evaluations`
8. acceso a `/evaluation-templates`
9. logout correcto

### 7.3 Verificación de usuarios tras el deploy

```bash
mysql -h "$PROD_DB_HOST" -P "$PROD_DB_PORT" -u "$PROD_DB_USER" -p -D "$PROD_DB_NAME" -e "
SELECT id, name, email, role, default_club, club_id, default_team, default_team_id
FROM users
ORDER BY id;
"
```

Comprueba:

- siguen todos los usuarios esperados
- `club_id` está poblado donde corresponde
- no hay cuentas nuevas inesperadas

## Fase 8: rollback

Haz rollback si ocurre cualquiera de estos casos:

- la app no arranca
- login roto
- datos históricos inaccesibles
- usuarios o permisos inconsistentes
- errores SQL repetidos en logs

### 8.1 Rollback de código

Identifica el release anterior:

```bash
ls -1 "$APP_ROOT/releases"
```

Reapunta `current`:

```bash
ln -sfn "$APP_ROOT/releases/RELEASE_ANTERIOR" "$APP_ROOT/current"
```

Reinicia:

Con `systemd`:

```bash
sudo systemctl restart soccer-report
```

Con `pm2`:

```bash
cd "$APP_ROOT/current"
pm2 restart soccer-report --update-env
```

### 8.2 Restauración de base de datos

No la hagas por defecto.

Solo restaura la base si confirmas que el arranque modificó datos de forma incorrecta y no basta con volver al código anterior.

Proceso:

```bash
mysql -u root -p -e "DROP DATABASE IF EXISTS ${PROD_DB_NAME};"
mysql -u root -p -e "CREATE DATABASE ${PROD_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p "$PROD_DB_NAME" < "$APP_ROOT/shared/backups/${PROD_DB_NAME}-AAAA-MM-DD-HHMMSS.sql"
```

Después, vuelve a levantar el release antiguo.

## Decisiones recomendadas para este upgrade

### Sobre `ADMIN_EMAIL`

Antes de producción, decide una de estas dos opciones:

1. Configurarlo con un email de admin ya existente para evitar crear una cuenta nueva.
2. Aceptar que la app cree un superadmin nuevo y documentarlo.

La opción más conservadora es la primera.

### Sobre ventana de despliegue

Haz el upgrade en baja actividad. Aunque el cambio de código sea rápido, el salto funcional desde `080ad37` es suficientemente grande como para exigir verificación manual inmediata.

### Sobre staging

Si no puedes clonar producción a staging, no recomendaría hacer este upgrade directo.

## Checklist final de ejecución

1. confirmar commit actual `080ad37`
2. generar dump completo
3. generar dump de esquema
4. clonar DB a staging
5. arrancar `b0e41da` en staging
6. validar login, usuarios, informes y jugadores
7. preparar release de producción
8. ejecutar `initializeDatabase()` en ventana de deploy
9. activar release
10. reiniciar servicio
11. smoke test
12. monitorizar logs
13. rollback si algo falla
