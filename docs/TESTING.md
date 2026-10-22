# Estrategia de pruebas

## Comprobaciones por cambio

Ejecutar los comandos existentes del proyecto. En el bootstrap, definir scripts reales para:
- lint
- typecheck
- test
- test:integration
- test:e2e
- build

No declarar un comando ejecutado si no se ejecutó. No crear scripts vacíos que siempre devuelvan éxito.

## Pruebas unitarias

- Cálculos de disponibilidad y duración.
- Conversión de unidades.
- Cálculo de escandallos.
- Reglas de publicación.
- Matriz de permisos.
- Validación de datos.

## Pruebas de integración

- Migraciones desde una base vacía.
- Restricciones y transacciones.
- Movimientos de inventario.
- Versionado y publicación de cartas.
- Asignación de mesas y reservas.
- Autorización en servidor.
- RLS, si se usa.

## Pruebas E2E

- Configuración de organización y establecimiento.
- Crear productos y carta, previsualizar y publicar.
- Consultar la carta pública sin revelar datos privados.
- Crear, confirmar y cancelar una reserva.
- Registrar recepción y movimiento de stock.
- Invitar usuario y comprobar permisos.
- Exportar solo datos autorizados.

## Pruebas negativas de seguridad

- Usuario de organización A intenta leer o cambiar datos de B.
- Manipulación de IDs y roles en el cliente.
- Acceso a borradores.
- Reutilización de invitaciones.
- Lectura de archivos privados.
- Exportación sin permisos.
- Entradas maliciosas y límites de solicitudes.
- Secretos en bundles cliente o logs.

## Concurrencia

Simular dos peticiones simultáneas para la misma mesa y franja; solo se deben aceptar asignaciones compatibles. Simular reintentos de movimientos y comprobar que no duplican el stock.

## Recuperación

Documentar y ejecutar una restauración de copia de seguridad en entorno no productivo. Comprobar migraciones y recuperación tras fallo.

## Reporte

Separar claramente PASÓ, FALLÓ, NO EJECUTADO y BLOQUEADO. Las pruebas de seguridad y concurrencia deben aportar resultados verificables.
