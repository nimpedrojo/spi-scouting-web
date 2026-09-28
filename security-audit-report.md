# Auditoría de Seguridad — SoccerProcessIQ Suite

Fecha: 2026-06-11

## Resumen ejecutivo
- Estado: revisión de seguridad completa del repositorio. Se identificaron varias áreas de riesgo (dependencias, gestión de secretos, sesiones, XSS y control de subidas). Se aplicaron correcciones mínimas inmediatas.
- Acciones inmediatas realizadas: añadido `.gitignore`, eliminado `.env` del repo, saneado nombres de ficheros en upload handlers, ejecución de `npm audit` y `npm audit fix` (parches aplicables).

## Hallazgos principales (prioridad)

- **Alta:** Dependencia `xlsx` (SheetJS) con vulnerabilidades de Prototype Pollution y ReDoS; actualmente no dispone de fix seguro en la versión usada. Archivo: `package.json` (dependencia directa).
- **Alta:** Sesiones en MemoryStore: `express-session` usado sin `store` persistente en `src/app.js` (riesgo en producción: pérdida de sesión, DoS por MemoryStore).
- **Alta:** Secretos comprometidos / débiles: `.env` contenía `SESSION_SECRET` débil; ya eliminado del repositorio — se debe rotar inmediatamente.
- **Media:** `src/services/secretStore.js` hace fallback a texto plano si `APP_SECRET_KEY` no está configurada; riesgo de almacenamiento de credenciales en claro.
- **Media:** Uso inseguro de nombres de ficheros subidos (`file.originalname`) en algunos handlers — mitigado en `src/routes/playerAdminRoutes.js` y `src/controllers/evaluationController.js` (saneado).
- **Media:** Uso de EJS sin escape (`<%- ... %>`) en varias plantillas para insertar JSON/HTML (ej.: `src/views/reports/detail.ejs`) — riesgo de XSS si datos provienen de usuarios.
- **Baja:** Falta de `helmet()` y `csurf()` para cabeceras y protección CSRF en `src/app.js`.

## Acciones realizadas

- Añadido: `/.gitignore` (ignora `.env`, `node_modules`, `logs`, etc.).
- Eliminado: `/.env` del repositorio (rotar secretos locales/CI recomendada).
- Sanitizado filenames en subidas en:
  - `src/routes/playerAdminRoutes.js`
  - `src/controllers/evaluationController.js`
- Ejecutado: `npm audit` y `npm audit fix` — resultado: quedan 1 vulnerabilidad alta en `xlsx` sin fix disponible.

## Recomendaciones concretas (ordenadas por prioridad)

1. **Rotar secretos ahora**: generar un `SESSION_SECRET` robusto y cualquier credencial posible comprometida.
   - Ejemplo: `openssl rand -base64 32`
2. **Configurar store de sesiones persistente** (Redis o MySQL). Ejemplo recomendado: `connect-redis` con `express-session`.
3. **Forzar cifrado de secretos**: cambiar `secretStore` para rechazar operaciones si `APP_SECRET_KEY` no está presente (no fallback a texto plano).
4. **Mitigar o reemplazar `xlsx`**:
   - Opción A (recomendada): reemplazar `xlsx` por `exceljs` y adaptar import/export donde se use.
   - Opción B: mantener `xlsx` pero restringir y validar estrictamente cualquier fichero entrante (limitar tamaño, sanitizar celdas, ejecutar parsing en proceso aislado).
5. **Añadir `helmet()` y `csurf()`** en `src/app.js` y actualizar formularios POST con token CSRF.
6. **Corregir plantillas EJS**: evitar `<%-` para datos no confiables; insertar JSON seguro dentro de `<script type="application/json">` o usar `encodeURIComponent` y parsear en cliente.
7. **Actualizar dependencias y políticas de mantenimiento**: programar `npm audit` periódico y mantener un calendario de upgrades. Ejecutar `npm test` tras updates.
8. **Añadir rate-limiting** en endpoints sensibles (login, import) y alertas para múltiples fallos.

## Comandos útiles

```bash
# Generar secret seguro
openssl rand -base64 32

# Ejecutar auditoría y aplicar fixes automáticos
npm audit
npm audit fix

# Probar la suite
npm test
```

## Próximos pasos sugeridos (tareas ejecutables)

- Implementar `helmet()` + `csurf()` y actualizar vistas con tokens CSRF.
- Configurar Redis session store y mover sesiones a Redis en entornos prod.
- Decidir estrategia para `xlsx`: reemplazo por `exceljs` (implementación y pruebas) o mitigación con sanitizado + sandboxing.
- Revisar y corregir todas las ocurrencias de `<%-` en plantillas donde se incluyan datos de usuario.

## Observaciones finales

El proyecto muestra buenas prácticas en gran parte del acceso a la base de datos (uso de placeholders en consultas). Las áreas de mayor riesgo son dependencias de terceros (`xlsx`) y la gestión de secretos/sesiones. Priorizar rotación de secretos y configurar un store de sesiones persistente. Estoy disponible para aplicar cualquiera de los próximos pasos (implementación de CSRF/helmet, configuración de Redis, o migración de `xlsx` a `exceljs`).

---

Informe generado automáticamente por la auditoría interna del repositorio.
