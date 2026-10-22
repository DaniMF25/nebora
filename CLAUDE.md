# Instrucciones del proyecto para Claude

## Fuente de verdad

Antes de cualquier tarea, consulta:
1. `PROJECT.md`
2. `project/STATUS.md`
3. `project/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. Los documentos pertinentes de `docs/`

Examina también el estado de Git y el código real. La documentación no demuestra que una función esté implementada.

## Objetivo

Desarrollar GastroFlow, un SaaS multiempresa de gestión de restaurantes, con cartas digitales, inventario, mesas, reservas, horarios, proveedores, personal e informes. El alcance inicial excluye TPV, procesamiento de pagos, cierres de caja y ventas operativas.

## Protocolo de ejecución

- Trabaja en una tarea pequeña y verificable por vez.
- Antes de editar, resume objetivo, archivos probables, riesgos y criterios de aceptación.
- No rehagas el proyecto desde cero ni sobrescribas trabajo existente sin examinarlo.
- Mantén la aplicación ejecutable cuando sea razonable.
- No generes pantallas con botones ficticios ni sustituyas lógica por datos aleatorios.
- No marques una función como completada solo porque existe su interfaz.
- No elimines pruebas para conseguir que la compilación pase.
- No desactives controles de seguridad para hacer pasar una prueba.
- No añadas dependencias sin justificar su necesidad.
- Documenta cambios de arquitectura en `project/DECISIONS.md`.
- No realices despliegues, operaciones destructivas o cambios en producción sin autorización explícita.

## Seguridad no negociable

- La autorización se comprueba en el servidor; ocultar elementos en el frontend no es control de acceso.
- Aísla organizaciones en consultas, escrituras, archivos, exportaciones y trabajos en segundo plano.
- Nunca confíes en `organization_id`, roles o permisos enviados por el cliente sin validarlos.
- Nunca expongas secretos en código cliente, logs, Git o mensajes de error.
- Usa validación del servidor, consultas parametrizadas, restricciones de base de datos y transacciones en operaciones críticas.
- Trata reservas concurrentes y movimientos de inventario como problemas de integridad de datos, no solo de interfaz.
- No ejecutes migraciones destructivas en producción.
- Si encuentras una vulnerabilidad crítica, detén el trabajo dependiente, documenta el problema y prioriza corregirla.

## Pruebas y afirmaciones

- Ejecuta pruebas relevantes y reporta los comandos y resultados reales.
- Diferencia pruebas pasadas, fallidas, no ejecutadas y bloqueadas.
- No afirmes que el producto es seguro, está auditado o listo para producción sin evidencia.
- No simules integraciones externas: usa adaptadores claramente marcados como no configurados.
- Si una prueba no se puede ejecutar, explica por qué.

## Cierre obligatorio de cada tarea

1. Revisa el diff y los archivos modificados.
2. Ejecuta pruebas, lint, typecheck y build disponibles, según proceda.
3. Revisa secretos, permisos, cambios de esquema y efectos secundarios.
4. Actualiza `project/STATUS.md` y `project/ROADMAP.md`.
5. Añade decisiones relevantes a `project/DECISIONS.md`.
6. Informa de cambios, pruebas y resultados, riesgos, pendientes y siguiente tarea.
7. No hagas commit automáticamente salvo que el usuario o el flujo acordado lo autorice.

## Si el contexto se agota

Detén el inicio de nuevas funciones. Deja los cambios en un estado seguro, documenta qué está completo y qué no en `project/STATUS.md`, incluyendo la siguiente tarea concreta y los comandos de prueba pendientes. No declares éxito si hay verificaciones pendientes.

## Alcance funcional inicial

Prioridad:
1. Arquitectura, autenticación y aislamiento multiempresa.
2. Dashboard y configuración de establecimientos.
3. Constructor de cartas con temas, borradores, publicación y QR.
4. Inventario, recetas, escandallos, proveedores y compras.
5. Mesas, horarios y reservas.
6. Personal, clientes e informes.
7. Hardening, recuperación y preparación de producción.

No construir TPV ni cobros en esta versión.
