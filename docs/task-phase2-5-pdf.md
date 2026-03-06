# Task Phase2.5 - PDF de jugador

## Implementado

- Nuevas rutas:
  - `GET /players/:id/pdf`
  - `GET /players/:id/pdf/preview`
- Preparación del documento en servicio:
  - [src/services/pdfReportService.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/services/pdfReportService.js)
- Integración en controlador y rutas:
  - [src/controllers/playerProfileController.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/controllers/playerProfileController.js)
  - [src/routes/playerProfileRoutes.js](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/routes/playerProfileRoutes.js)
- Vista imprimible de una página:
  - [src/views/players/pdf.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/players/pdf.ejs)
- CSS dedicado a impresión/PDF:
  - [src/public/css/player-pdf.css](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/public/css/player-pdf.css)
- Botón PDF conectado desde el perfil actual:
  - [src/views/players/show.ejs](/Users/nimpedrojo/Documents/Desarrollo/soccer_report/src/views/players/show.ejs)

## Enfoque

- El informe se renderiza como HTML server-side listo para imprimir o guardar como PDF desde navegador.
- Se reutilizan datos de:
  - analítica de jugador
  - informes existentes
  - notas de evaluación cuando existen
- El diseño prioriza lectura clara para familias:
  - cabecera con contexto de club y temporada
  - bloque de identidad
  - resumen técnico con radar chart
  - actividad y seguimiento
  - pie con fecha de generación

## Tests

- Render de ruta PDF
- Ruta PDF con evaluaciones
- Ruta PDF con datos opcionales ausentes
