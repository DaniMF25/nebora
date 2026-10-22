# Operaciones y despliegue

## Entornos

Mantener desarrollo, pruebas y producción separados. No utilizar datos reales de clientes en pruebas.

## Configuración

- Incluir `.env.example` con nombres y descripciones, nunca valores secretos reales.
- Validar variables obligatorias al arrancar.
- Fallar de forma segura si falta configuración crítica.
- No exponer variables privadas al cliente.

## Base de datos

- Migraciones versionadas y revisadas.
- Copias de seguridad según las capacidades y el plan del proveedor.
- Definir RPO/RTO con el propietario del producto.
- Probar restauraciones periódicamente.
- No aplicar migraciones destructivas automáticamente en producción.

## Observabilidad

- Logs estructurados con redacción de información sensible.
- Seguimiento de errores y alertas.
- Auditoría separada de logs técnicos.
- Alertas para fallos repetidos y actividad sospechosa.

## Despliegue

- CI ejecuta lint, typecheck, pruebas y build.
- Bloquear despliegues ante fallos críticos.
- Despliegues graduales cuando la infraestructura lo permita.
- Plan de reversión.
- Procedimiento de respuesta a incidentes y rotación de credenciales.

## Lista previa a producción

- Revisión independiente de seguridad.
- Pruebas de aislamiento multiempresa.
- Pruebas de concurrencia.
- Restauración verificada.
- Política de retención y privacidad revisada.
- Monitorización y alertas activas.
- Integraciones verificadas con credenciales de producción.
- Sin vulnerabilidades críticas conocidas sin resolver.
