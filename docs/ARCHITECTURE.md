# Arquitectura — propuesta inicial

## Stack preferente

- Next.js App Router y React con TypeScript estricto.
- PostgreSQL.
- Supabase puede ser una opción para PostgreSQL, autenticación y almacenamiento si la implementación de permisos es correcta; alternativa: PostgreSQL gestionado y proveedor de identidad maduro.
- Tailwind CSS y componentes accesibles.
- Zod o validación equivalente compartida, con validación obligatoria en servidor.
- Vitest para pruebas unitarias, pruebas de integración con PostgreSQL y Playwright para E2E.
- CI para ejecutar lint, typecheck, pruebas y build.

La herramienta elegida puede requerir ajustes. Antes de adoptar otra tecnología, documentar compatibilidad, ventajas, riesgos y coste operativo. Evitar microservicios prematuros.

## Capas

1. Interfaz: páginas y componentes; no contiene autorización como única barrera.
2. Servicios de aplicación: casos de uso y validación de permisos.
3. Dominio: reglas de reservas, publicación, inventario y permisos.
4. Persistencia: consultas, transacciones y restricciones.
5. Integraciones: correo, almacenamiento y proveedores externos.
6. Observabilidad: logs estructurados, métricas y auditoría.

## Multiempresa

- Definir organización como frontera de aislamiento.
- Entidades privadas incluyen `organization_id` directamente o mediante relación verificable.
- Usar claves foráneas y restricciones que impidan relaciones cruzadas.
- Centralizar resolución de contexto y autorización en servidor.
- Si se utiliza RLS, probar explícitamente SELECT, INSERT, UPDATE y DELETE; no confiar solo en filtros de frontend.
- Las tareas en segundo plano y exportaciones también deben tener contexto de organización autorizado.
- El contenido público de cartas debe leerse únicamente desde una versión publicada.

## Transacciones e idempotencia

Usar transacciones para crear reservas y asignaciones, publicar versiones y registrar movimientos de inventario. Añadir idempotencia a operaciones que puedan reintentarse. Las operaciones correctivas de inventario deben ser movimientos compensatorios auditados.

## Decisiones pendientes

La elección definitiva de proveedor de identidad, hosting, almacenamiento, correo, estrategia de trabajos asíncronos y política de copias de seguridad se hará después de verificar las capacidades reales de la herramienta y los requisitos operativos.
