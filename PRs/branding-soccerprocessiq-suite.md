# PR: Branding & Dashboard — SoccerProcessIQ Suite (presentation only)

Branch: branding/soccerprocessiq-suite

## Resumen

Este PR aplica cambios de presentación para alinear la UI con el nuevo naming "SoccerProcessIQ Suite" y reestructura el dashboard principal para exponer claramente:

- BLOQUE 1 — Contexto
- BLOQUE 2 — SPI Core (accesos y KPIs básicos)
- BLOQUE 3 — SPI Modules (tarjetas por módulo, solo si están activos)

Todos los cambios son de presentación (EJS + copy + microcopy). No se modificó lógica de negocio, rutas ni modelos.

## Archivos modificados / añadidos

- `README.md` (texto de presentación)
- `AGENTS.md` (header actualizado)
- `src/app.js` (pageTitle por defecto)
- `src/views/layout.ejs` (title fallback)
- `src/views/partials/sidebar.ejs` (sidebar title/subtitle)
- `src/views/partials/topbar.ejs` (header fallback)
- `src/views/auth/login.ejs` (login alt text)
- `src/views/dashboard/index.ejs` (restructuración completa del dashboard)
- `src/services/evaluationTemplateService.js` (plantilla description)
- `src/public/css/styles.css` (comentario branding)
- `src/public/css/theme.css` (comentario branding)
- `tests/app.test.js` (descripcion del test)
- `docs/*` (nuevos docs: product-overview, functional-architecture, technical-architecture, branding-and-naming)

## Cambios clave

- Page title y cabeceras visibles ahora muestran `SoccerProcessIQ Suite`.
- Sidebar y login mantienen los assets existentes como fallback (`/img/soccerreport-logo.png`) pero muestran el nuevo nombre en texto y `alt`.
- Dashboard reordenado para separar claramente Core y Módulos; las tarjetas de módulo solo se muestran si `activeModuleKeys` lo permite.

## Verificación local (instrucciones)

1. Instalar dependencias si es necesario:

```bash
npm install
```

2. Ejecutar en desarrollo:

```bash
npm run dev
```

3. Login y revisar dashboard con diferentes clubes/roles:
- Usuario sin club: comprobar bloque Contexto y mensajes de fallback.
- Usuario con club y `scouting_players` activado: ver sección `SPI Scouting Players` y tabla de pendientes.
- Usuario admin: comprobar sección `Administración`.

## Riesgos / notas

- No se cambiaron rutas ni lógica backend.
- No se renombraron assets gráficos en disco (para evitar roturas). Recomendación: añadir nuevos assets y reemplazar en PR separado.
- Si se desea exponer `CLUB_MODULE_META` dinámicamente en la vista (para etiquetas), requiere un pequeño cambio en el middleware para inyectarlo.

## Pasos siguientes sugeridos

- Revisar en staging y confirmar assets nuevos (logos, favicons) en despliegue coordinado.
- Posible PR separado para reemplazar referencias a `soccerreport-logo.png` por `soccerprocessiq-logo.png` una vez dispongamos de los assets.

---

_Este archivo es un borrador local del PR. Para publicar el PR en GitHub, empuja la rama al remoto y crea el PR a través de la interfaz o `gh`._
