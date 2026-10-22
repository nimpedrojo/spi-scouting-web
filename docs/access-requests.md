# Solicitudes de acceso

El login ofrece «Solicitar acceso». GET /request-access muestra el formulario
público con nombre/email/organización obligatorios, cargo/motivo opcionales y
confirmación de lectura de privacidad. No solicita contraseña, archivos ni lista
pública de clubes. La respuesta de éxito no distingue cuentas existentes ni
solicitudes repetidas. No crea usuarios, sesión autenticada, clubes ni roles.

GET /register redirige al formulario nuevo; POST /register también redirige y ya
no crea una cuenta, incluso con código de club válido. Los usuarios existentes
conservan su acceso y los administradores pueden seguir dando altas manuales.

La administración de plataforma muestra el contador de pendientes y enlaza a
/admin/access-requests. Solo superadmin puede listar, abrir y revisar solicitudes.
Se filtran por estado, con 20 filas por página y orden estable por fecha/UUID.
Los administradores de club no acceden a esta bandeja global.

Estados y acciones:

- pending: pendiente, puede marcarse contactada o rechazada.
- contacted: se ha contactado con la persona; puede rechazarse posteriormente.
- rejected: revisión cerrada, sin reapertura pública.

Marcar contactada no crea cuenta ni envía correo. El responsable contacta por un
canal verificado y, si procede, utiliza el alta manual existente para asignar club
y rol. El formulario no verifica la propiedad del email ni de la organización:
ninguna afirmación del solicitante justifica conceder acceso automáticamente.
No se envían invitaciones, notificaciones ni contraseñas por email en esta versión.

## Datos y protección

access_requests es una tabla nueva, con UUID, límites VARCHAR, email único, índice
estado/fecha y revisor vinculado a users mediante FK ON DELETE SET NULL. La creación
idempotente se ejecuta después de users en initDb y usa sql/access-requests.sql.
No se modifica el esquema de users ni se altera la contraseña de cuentas existentes.

Se normaliza email y se valida texto/tipos/longitudes en servidor. La restricción
única resuelve envíos concurrentes; los duplicados no sobrescriben nombre, mensaje
ni estado, tampoco después de la revisión. Una persona no puede volver a presentar
la solicitud con ese email mientras exista la fila. Esto evita la reapertura
anónima de solicitudes revisadas; un cambio o retirada debe gestionarlo el responsable.
Las revisiones usan una actualización atómica condicionada a la versión y estado
previos: las acciones obsoletas o incompatibles devuelven 409.

Los POST nuevos requieren token CSRF ligado a sesión. El formulario público tiene
honeypot y un límite separado del login: 5 envíos/IP/15 minutos, 429 y Retry-After.
El mapa tiene capacidad limitada y caducidad; funciona con el proceso fork actual,
se reinicia con la aplicación y no es un mecanismo distribuido contra botnets.
El backend debe seguir limitado a localhost y trust proxy debe corresponder al
proxy real para que la IP del limitador sea fiable.

Las vistas escapan contenido y los endpoints nuevos usan Cache-Control:no-store
más noindex. Los errores de esta funcionalidad no registran SQL ni valores enviados.
El logging HTTP existente conserva metadatos habituales; no se añade IP/user-agent
al registro de solicitud. Los logs de revisión contienen UUID, actor y estado.

La información de privacidad incluye la recogida de solicitudes. No se establece
una base jurídica nueva ni se inventa un responsable/contacto legal. Antes de abrir
el formulario públicamente, el titular debe confirmar el aviso/contacto operativo
y su plazo de conservación. No hay borrado automático; las retiradas y depuración
se gestionan por el responsable con acceso autorizado a la base y a sus backups.
No se deben conservar solicitudes indefinidamente por falta de revisión operativa.

## Pruebas

Jest/Supertest cubre formulario y confirmación, creación sin alta, normalización,
duplicados y revisiones concurrentes, datos inválidos, CSRF, honeypot, límites,
contenido escapado, fallos de base sin falsos éxitos ni filtrado de datos,
autorización de los tres roles, filtros/paginación, contador e inicialización
idempotente. También comprueba la retirada del registro con código de club válido.
La suite completa se ejecuta contra una base local aislada, nunca producción.
Validación local: Node 22.23.3, MySQL local aislado, 12 suites / 276 tests
superados (45 casos nuevos). No se ha ejecutado en MariaDB de producción.

## Entrega de esquema: detenerse antes del merge automático

Esta rama cambia initDb, un modelo y SQL. El helper instalado bloquea esas rutas
ANTES de parar la aplicación. No se ha cambiado ni desactivado esa protección.
Crear previamente la tabla no hace desaparecer el bloqueo del diff de código.
No se debe hacer merge esperando que el deploy automático active esta entrega.

Secuencia para preparar con el operador, sin ejecutar nada desde esta PR:

1. Revisar PR/CI, el SQL aditivo y el contrato de campos/FK con la versión MariaDB
   real. Ensayar en una copia aislada: initDb dos veces, solicitud, revisión, login
   y rollback de código manteniendo la tabla. Sin tocar datos productivos.
2. Antes de integrar, poner la Repository variable PRODUCTION_DEPLOY_ENABLED=false
   para evitar una ejecución automática que quedaría bloqueada. No cancelar un
   deploy que ya esté en marcha. Guardar SHA/release/dumps actuales y verificar
   recuperación, copia privada y backup fuera del VPS.
3. Preparar una activación manual de esquema específicamente revisada para el SHA
   integrado: checkout inmutable nuevo, npm ci --omit=dev sin .env, enlaces shared,
   ecosystem esperado y solo soccer-report. No usar el script de primera instalación:
   ya hay producción. No editar el release activo ni eliminar la comprobación
   schemaChanges del helper para forzar el paso.
4. En la ventana acordada, detener solo la aplicación objetivo y crear/verificar
   snapshot consistente de DB, archivos compartidos y dumps PM2 ANTES del arranque
   con initDb nuevo. La creación de la tabla debe fallar de forma visible si no
   dispone de permisos o el esquema de users es distinto del esperado.
5. Activar el SHA nuevo con el procedimiento manual revisado, validar /health,
   /login, formulario y bandeja con superadmin, comprobar otras apps, actualizar
   current y guardar PM2. Si falla, recuperar el código previo y los dumps guardados;
   no restaurar SQL automáticamente ni borrar la tabla con solicitudes ya recibidas.
6. Copiar/verificar el snapshot fuera del VPS, registrar el SHA activo y volver a
   habilitar la variable cuando esté estable. Desde ese nuevo baseline, los merges
   posteriores sin cambios de esquema podrán volver al helper automático habitual.

La preparación/ejecución del bloque operativo del paso 3 requiere revisión separada
con el estado real del VPS. Esta implementación no despliega, no modifica secretos,
no cambia el helper instalado y no modifica ninguna variable de GitHub.
