# Prompt — Revisión de seguridad de una fase

Realiza una revisión de seguridad de la fase actual sin asumir que las medidas están implementadas solo porque aparezcan documentadas.

Examina:
- Autenticación, sesiones y recuperación.
- Autorización en servidor.
- Aislamiento entre organizaciones.
- Acceso a archivos, exportaciones y tareas asíncronas.
- Validación y consultas de base de datos.
- Secretos y variables de entorno.
- XSS, CSRF cuando aplique, SSRF, cargas de archivos y rate limiting.
- Transacciones, concurrencia e idempotencia.
- Registros de auditoría y datos personales.
- Dependencias y configuración de despliegue.

Ejecuta las pruebas disponibles y añade pruebas negativas para riesgos relevantes. No realices pruebas destructivas en producción ni ataques a sistemas externos.

Clasifica los hallazgos por severidad, proporciona evidencia reproducible y propone correcciones concretas. No afirmes que se ha realizado una auditoría certificada. Actualiza la documentación con resultados reales y limitaciones.
