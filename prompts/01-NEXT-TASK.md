# Prompt — Ejecutar la siguiente tarea

Lee `CLAUDE.md`, `project/STATUS.md`, `project/ROADMAP.md` y la documentación técnica pertinente. Inspecciona Git y el código real.

Selecciona una única tarea pendiente de la fase actual que pueda completarse de forma segura. Antes de editar, indica objetivo, criterios de aceptación, archivos probables y riesgos.

Implementa solo esa tarea. Respeta arquitectura, aislamiento multiempresa, migraciones y pruebas. No sustituyas lógica por datos ficticios ni marques interfaces sin backend como funcionales.

Ejecuta las pruebas pertinentes, lint, typecheck y build disponibles. Revisa el diff y los posibles secretos. Si algo falla, corrígelo o documenta con precisión el bloqueo.

Actualiza `project/STATUS.md`, `project/ROADMAP.md` y `project/DECISIONS.md` cuando proceda. No hagas commit ni despliegue sin autorización explícita.

Devuelve: cambios, archivos, pruebas y resultados, limitaciones, riesgos y siguiente tarea.
