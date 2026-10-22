# Requisitos de seguridad

Este documento define requisitos de diseño; no certifica que estén implementados.

## Referencias

Usar OWASP ASVS como marco de verificación y OWASP Top 10 como guía de riesgos. Definir una versión concreta de las referencias durante la fase de arquitectura.

## Identidad y sesiones

- Proveedor de identidad maduro; no implementar criptografía propia.
- MFA obligatorio para propietarios y administradores cuando el proveedor lo permita.
- Recuperación con tokens de un solo uso y caducidad limitada.
- Protección contra fuerza bruta y enumeración de cuentas.
- Cookies de sesión seguras cuando corresponda, revocación y reautenticación en acciones críticas.

## Autorización y aislamiento

- Denegar por defecto.
- Comprobar permisos en servidor para cada operación.
- Prevenir IDOR/BOLA y escalada de privilegios.
- Probar aislamiento entre organizaciones para API, consultas, archivos, exportaciones y procesos asíncronos.
- No confiar en roles ni IDs suministrados por el cliente.
- Restringir accesos administrativos y credenciales privilegiadas.

## Aplicación

- Validación del servidor y consultas parametrizadas.
- Protección frente a XSS, CSRF cuando corresponda, SSRF, traversal, asignación masiva y carga de archivos maliciosos.
- CSP y cabeceras HTTP adecuadas.
- CORS restrictivo.
- Rate limiting en autenticación y formularios públicos.
- Verificar firma y antigüedad de webhooks cuando existan.
- No mostrar trazas internas al usuario.
- Dependencias mantenidas y análisis automatizado de vulnerabilidades.

## Secretos y datos

- Nunca versionar `.env` real, claves privadas o tokens.
- Proporcionar `.env.example` sin secretos.
- Secretos en gestor de secretos o configuración protegida del entorno.
- No registrar contraseñas, tokens ni datos personales innecesarios.
- Archivos privados con autorización y URLs firmadas de duración limitada cuando proceda.
- Cifrado en tránsito y en reposo mediante infraestructura adecuada.

## Auditoría

Registrar de forma minimizada actor, organización, acción, entidad afectada, fecha y resultado para cambios sensibles, permisos, publicaciones, movimientos de inventario y exportaciones. Restringir el acceso a los logs y evitar secretos y datos personales innecesarios.

## Operaciones

- Entornos separados.
- Migraciones revisadas; nunca ejecutar migraciones destructivas automáticamente en producción.
- Copias de seguridad y pruebas de restauración.
- Monitorización, alertas y respuesta a incidentes.
- Revisión de permisos de base de datos.
- Análisis de secretos, dependencias y código en CI.

## Privacidad

Diseñar para facilitar RGPD/LOPDGDD cuando sean aplicables: minimización, finalidad, retención, gestión de solicitudes, encargados y eliminación. No declarar cumplimiento automático por el mero hecho de implementar funciones técnicas.

## Puerta de producción

No lanzar con vulnerabilidades críticas conocidas, aislamiento multiempresa sin pruebas, secretos expuestos, restauración no verificada o errores de integridad en reservas/inventario. La preparación para producción requiere revisión técnica independiente.
