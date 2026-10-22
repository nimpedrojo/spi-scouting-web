# Entrega controlada: solicitudes de acceso (PR #25)

Estado: preparación, sin despliegue ejecutado. El código de la PR original pasó
CI y 276 tests locales. Esta entrega incluye tres archivos de esquema nuevos o
modificados; el helper automático normal los bloquea antes de parar producción.
No se elimina esa protección ni se modifica el helper instalado.

El procedimiento utiliza dos scripts de operación manual y el helper root-owned
existente. No se puede ejecutar con la clave SSH de Actions (solo acepta deploy).
Usa una sesión administrativa de ubuntu, con otra sesión abierta para recuperación.
No corras estos scripts como root. No ejecutes primera instalación sobre la app viva.

## A. Recoger el estado real (solo lectura, VPS)

```bash
whoami
node --version
npm --version
readlink -f /var/www/spi-scouting-deploy/current
stat -c '%U:%G %a %n' /usr/local/libexec/spi-scouting-deploy.cjs
sha256sum /usr/local/libexec/spi-scouting-deploy.cjs
df -h /var/www/spi-scouting-deploy
sudo mariadb --execute="
SELECT VERSION();
SELECT ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='player_iq_db' AND TABLE_NAME='users';
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_KEY
 FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='player_iq_db' AND TABLE_NAME='users' AND COLUMN_NAME='id';
SELECT COUNT(*) AS access_requests_exists FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='player_iq_db' AND TABLE_NAME='access_requests';
SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
 WHERE SCHEMA_NAME LIKE 'spi_rehearsal_%';
"
```

Confirma current y los demás procesos con una vista saneada, sin mostrar env:

```bash
pm2 jlist | node -e '
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
 console.log(JSON.parse(input).map(p=>({name:p.name,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd})));
});'
```

Debe seguir existiendo un único soccer-report online con CWD de current. La FK
nueva requiere users InnoDB con id INT firmado, PRIMARY KEY, NOT NULL. El script
se detiene si access_requests ya existe: no se reintenta una entrega parcial sin
revisión. El helper instalado debe coincidir byte a byte con el del candidato;
la huella del código revisado durante esta preparación es
ca517d777e527d7af64532fee8f24aa6cd0c960e794df4b84135dc82c2a9fadf.
Una diferencia exige investigación, no copiar por encima automáticamente.

No se asume que la base/cuenta/archivo temporal del ensayo anterior sigan disponibles.
Identifica su .env privado sin imprimirlo. Si no existe, provisiona mediante DBA
una copia reciente en una base spi_rehearsal_* con usuario restringido
spi_rehearsal[_sufijo] y privilegios solo sobre esa base. Importa un backup
verificado; no utilices root ni credenciales productivas para el ensayo Node.
No incluyas eventos/tareas que puedan escribir o llamar a servicios externos.
La cuenta debe poder crear la tabla y escribir/borrar las fixtures de su clon.

## B. Paquete operativo revisado (Mac, tras guardar los scripts en Git)

Define REVIEWED_COMMIT como el SHA completo revisado de la rama que contiene estos
scripts. Este SHA es para el paquete, no necesariamente el merge a desplegar.

```bash
(
  set -euo pipefail
  umask 077
  test -n "${REVIEWED_COMMIT:-}"
  OPS_DIR=$(mktemp -d /tmp/spi-access-release-XXXXXXXX)
  git archive --format=tar "$REVIEWED_COMMIT" \
    scripts/release-access-requests.cjs \
    scripts/rehearse-access-requests-schema.cjs \
    sql/access-requests.sql src/initDb.js src/models/accessRequestModel.js |
    tar -xf - -C "$OPS_DIR"
  find "$OPS_DIR" -type f -exec chmod 600 {} +
  (
    cd "$OPS_DIR"
    shasum -a 256 scripts/release-access-requests.cjs \
      scripts/rehearse-access-requests-schema.cjs \
      sql/access-requests.sql src/initDb.js src/models/accessRequestModel.js > SHA256SUMS
  )
  scp -r -P 22 "$OPS_DIR" ubuntu@51.75.255.4:/home/ubuntu/
  printf 'Paquete VPS: /home/ubuntu/%s\n' "$(basename "$OPS_DIR")"
)
```

En VPS establece OPS_DIR con la ruta exacta que imprimió el bloque; no uses un
marcador inventado ni una carpeta de producción. Después:

```bash
cd "$OPS_DIR"
sha256sum -c SHA256SUMS
node --check scripts/release-access-requests.cjs
node --check scripts/rehearse-access-requests-schema.cjs
```

El paquete no incluye contraseñas, .env, SQL de negocio ni dumps PM2.

## C. Ensayo SQL en MariaDB aislado

Establece REHEARSAL_ENV con la ruta absoluta al .env privado del clon. Su nombre
de base debe comenzar por spi_rehearsal_ y su usuario por spi_rehearsal. El script
rechaza la base productiva y usuarios root u otros nombres. Estas restricciones
no sustituyen verificar los GRANTs y el alcance real del usuario con el DBA.

```bash
cd "$OPS_DIR"
node scripts/rehearse-access-requests-schema.cjs "$REHEARSAL_ENV"
```

Comprueba creación dos veces preservando datos, email único, actualización por
versión y FK ON DELETE SET NULL. Inserta/elimina únicamente fixtures nuevas en el
clon; conserva la tabla para inspección. No arranca una aplicación ni PM2 y no
prueba el flujo completo de interfaces en MariaDB. CI cubre autenticación/UI por
Supertest en MySQL; una validación visual y de negocio sigue siendo necesaria.
No borres la base del clon ni su usuario durante estas comprobaciones.

## D. Antes de integrar la PR

1. Confirmar CI verde de la última revisión y ensayar SQL con ese paquete.
2. Confirmar un backup reciente verificado fuera del VPS y la vía de recuperación.
   Confirmar quién revisará las solicitudes, canal de contacto/privacidad y política
   de conservación. No se introducen emails automáticos ni borrado programado.
3. Poner Repository variable PRODUCTION_DEPLOY_ENABLED=false en GitHub. Esperar
   a que no haya otro deploy en marcha; no cancelarlo. Mantenerla desactivada
   hasta terminar esta entrega y sus comprobaciones.
4. Revisar/autorizar PR #25 y hacer merge. Verificar que el workflow de master valida
   y omite el job deploy por la variable. Anotar el SHA COMPLETO integrado.

Crear la tabla previamente no permite al helper normal saltarse el diff de esquema.
No usar flags --force, cambiar schemaChanges, ni instalar una versión permisiva del
helper. Esta excepción manual está acotada a huellas de tres archivos revisados:
SQL, initDb y accessRequestModel. Cualquier cambio adicional de modelo/SQL se rechaza.

## E. Preparar candidato sin parar producción (después del merge)

Establece TARGET_SHA con el SHA completo integrado y EXPECTED_CURRENT con el SHA
completo real del paso A. No son el mismo SHA. Define OPS_DIR con el paquete VPS.

```bash
cd "$OPS_DIR"
SPI_MANUAL_RELEASE_LOCK=access-requests /usr/bin/flock -n \
  /var/www/spi-scouting-deploy/shared/activation.lock \
  /usr/bin/node scripts/release-access-requests.cjs \
  --prepare "$TARGET_SHA" "$EXPECTED_CURRENT"
```

El modo prepare verifica runtime, daemon, current, DB, rama remota, huellas y
contrato PM2. Descarga el candidato inmutable, instala npm ci --omit=dev antes de
enlazar secretos/shared y comprueba que no haya ediciones de archivos versionados
salvo el movimiento esperado de uploads. No modifica DDL, current ni procesos.
Crea un directorio de snapshot de preflight con metadatos/dumps PM2: **todavía no
es un backup de DB/archivos y no sustituye el backup del modo activate**.

No sobreescribe un SHA existente. Si falla, inspecciona la carpeta y el estado de
la app antes de decidir cómo limpiar/reintentar; nunca borres el current activo.
Comprueba que producción siga respondiendo y que no haya cambiando la punta master.

## F. Ventana de activación (solo tras revisar A–E)

Este bloque SÍ detiene soccer-report. Otros procesos no se detienen. Mantén una
sesión de operador abierta y no realices cambios paralelos sobre PM2 o la DB.

```bash
cd "$OPS_DIR"
SPI_MANUAL_RELEASE_LOCK=access-requests /usr/bin/flock -n \
  /var/www/spi-scouting-deploy/shared/activation.lock \
  /usr/bin/node scripts/release-access-requests.cjs \
  --activate "$TARGET_SHA" "$EXPECTED_CURRENT" --confirm-stop-soccer-report
```

Se vuelven a comprobar estado y huellas, se detiene solo el objetivo y el helper
existente crea/verifica SQL + archivos/shared + dumps PM2. SOLO DESPUÉS del backup
se crea access_requests con el SQL fijado. La app nueva ejecutará de nuevo el
CREATE IF NOT EXISTS de forma idempotente durante su initDb normal.

Tras el arranque se comprueban salud local/pública, login, identidad de release y
otros PIDs/estados, además del formulario público, redirect del antiguo registro
y bloqueo de la bandeja para invitados. Se actualiza current, guarda PM2 y verifica.
Hay pérdida de sesiones en memoria y una parada durante backup/arranque.

Si falla backup/DDL se intenta reiniciar el proceso anterior; si falla después de
reemplazarlo se intenta restaurar el release anterior y dumps/puntero, usando el
ciclo ya instalado. Recuperar código previo también recupera su comportamiento anterior de /register.
No se restaura SQL ni borra la tabla creada: podrían existir
solicitudes nuevas. Un fallo de recuperación exige actuación del operador. La
existencia de la tabla bloquea reintentos automáticos de este script manual.
Ni un deadline ni los tests garantizan recuperación ante corte de energía/SIGKILL.

## G. Cierre y recuperación

Confirma current=TARGET_SHA, health/login, login real, fotos y descarga Excel,
además del formulario/bandeja con los roles adecuados. Prueba una solicitud legítima
controlada y revísala; no publiques datos personales ni contraseñas en las salidas.
Revisa otros procesos y el dump PM2 saneado. Copia el backup indicado por activate
fuera del VPS y verifica SHA256SUMS con tu clave administrativa, no con la de Actions.

Si el script informa recuperación fallida, no repitas ni ejecutes pm2 restart all:
recoge pm2 list, current y logs privados del objetivo; usa los valores previous y
candidate del release.json del backup. La recuperación manual debe seleccionar
explícitamente el ecosystem del release previo con SPI_RELEASE_PATH apuntando a
él, usando solo soccer-report. Revisa que esté sano antes de guardar PM2; no uses
resurrect/kill/reload global en el daemon compartido. No ejecutes DROP TABLE ni
importes database.sql sobre producción para arreglar un fallo de código.

Cuando todo esté validado, registra release/backup/resultado del ensayo y vuelve
a PRODUCTION_DEPLOY_ENABLED=true. La siguiente entrega sin cambios de esquema
podrá volver al helper normal desde el nuevo current. Su protección no habrá sido
modificada. Si el rollback dejó el código antiguo activo, mantén la variable false
y prepara una revisión de la entrega, no un deploy normal contra la tabla parcial.

## Validación del tooling

Tests aislados comprueban argumentos/confirmación, allowlist y huellas del esquema,
backup antes de DDL, recuperación según fase, probes nuevos y rechazo de identidades
SQL productivas. Importar los scripts desde Jest no importa el helper del VPS ni
abre una conexión. Validación local con Node 22.23.3 y MySQL aislado: 300 tests / 13 suites
superados, incluyendo 24 casos del tooling de entrega. La ejecución real del
ensayo MariaDB y la ventana de activación
quedan pendientes de los resultados del operador.
