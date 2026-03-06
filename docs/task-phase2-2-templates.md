# Task Phase 2.2 - Templates

## Implementado

- Tablas nuevas:
  - `evaluation_templates`
  - `evaluation_template_metrics`
- CRUD completo de plantillas de evaluación:
  - `GET /evaluation-templates`
  - `GET /evaluation-templates/new`
  - `POST /evaluation-templates`
  - `GET /evaluation-templates/:id`
  - `GET /evaluation-templates/:id/edit`
  - `POST /evaluation-templates/:id/update`
  - `POST /evaluation-templates/:id/delete`

## Servicio

- `evaluationTemplateService.js`
  - lista plantillas
  - obtiene métricas de plantilla
  - valida integridad
  - resuelve la mejor plantilla por contexto
  - aplica fallback por defecto si no existe una específica

## Integración

- El formulario de nueva evaluación permite seleccionar plantilla.
- También soporta carga SSR por `template_id` en `GET /evaluations/new`.
- Si no existe plantilla específica, usa la plantilla por defecto compatible con el modelo actual.
- Se mantiene compatibilidad con `evaluations` y `evaluation_scores`.
- No se rompe la creación manual existente.

## Vistas

- `src/views/evaluation-templates/index.ejs`
- `src/views/evaluation-templates/form.ejs`
- `src/views/evaluation-templates/show.ejs`

## Verificación

- Tests añadidos para:
  - creación
  - edición
  - borrado
  - resolución de plantilla por defecto
  - render del formulario de evaluación desde plantilla
- Verificado con `npm test`.
