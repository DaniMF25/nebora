# Roadmap de Nébora

Actualizar solo tras verificar trabajo real. Última actualización: 2026-10-22.

## Fase 0 — Descubrimiento y arquitectura
- [x] Verificar capacidades de Claude y entorno de ejecución.
- [x] Confirmar stack (D-004). Proveedores externos: pendientes (Fase 7).
- [x] Diseñar modelo de datos inicial (implementado el núcleo; resto en `docs/DATA_MODEL.md`).
- [x] Definir fronteras de confianza (rol `nebora_app`, RLS, contexto en servidor). Modelo de amenazas formal: pendiente para Fase 8.
- [x] Definir criterios de aceptación de la Fase 1.
- [x] Documentar decisiones (D-004 a D-009).

## Fase 1 — Fundación segura
- [x] Inicializar aplicación y scripts de calidad.
- [x] Configurar base de datos y migraciones.
- [x] Implementar autenticación y sesiones (sin MFA ni recuperación: requieren correo).
- [x] Implementar organizaciones y establecimientos.
- [x] Implementar membresías y permisos (roles, invitaciones, cambio de rol, baja, regla de último propietario). Permisos por establecimiento: pendientes hasta que un módulo los necesite.
- [x] Implementar aislamiento multiempresa (RLS + servicios).
- [x] Implementar auditoría mínima.
- [x] Probar acceso cruzado entre organizaciones (servicios, RLS y E2E).

**Puerta de salida:** las pruebas negativas de aislamiento pasan y el proyecto compila. — Superada el 2026-10-22 (CI de GitHub aún no ejecutado).

## Fase 2 — Interfaz y configuración
- [ ] Layout responsive y navegación.
- [ ] Selector de organización/establecimiento.
- [ ] Configuración de horarios y zona horaria.
- [ ] Dashboard con datos reales y estados vacíos.

## Fase 3 — Cartas digitales
- [ ] Categorías y productos.
- [ ] Editor y ordenación.
- [ ] Temas Moderno, Clásico, Futurista y Mediterráneo.
- [ ] Borradores y publicación atómica.
- [ ] Versiones.
- [ ] Página pública.
- [ ] QR SVG/PNG.
- [ ] Idiomas y alérgenos.
- [ ] Pruebas de aislamiento y publicación.

## Fase 4 — Inventario
- [ ] Ingredientes y unidades.
- [ ] Almacenes y movimientos.
- [ ] Recetas y escandallos.
- [ ] Proveedores y órdenes de compra.
- [ ] Recepciones y alertas.
- [ ] Pruebas de concurrencia e idempotencia.

## Fase 5 — Mesas y reservas
- [ ] Zonas y plano.
- [ ] Mesas y capacidades.
- [ ] Horarios y excepciones.
- [ ] Calendario.
- [ ] Reservas públicas y privadas.
- [ ] Asignaciones y prevención de solapamientos.
- [ ] Lista de espera.
- [ ] Pruebas de concurrencia.

## Fase 6 — Personal, clientes e informes
- [ ] Gestión de miembros y turnos.
- [ ] CRM opcional con minimización de datos.
- [ ] Informes operativos.
- [ ] Exportaciones seguras.

## Fase 7 — Suscripciones e integraciones
- [ ] Evaluar proveedor de suscripción.
- [ ] Configurar correo u otros proveedores necesarios.
- [ ] Implementar y verificar integraciones reales.
- [ ] Mantener desactivadas funciones no configuradas.

## Fase 8 — Preparación para producción
- [ ] Revisar OWASP ASVS aplicable.
- [ ] Ejecutar análisis de dependencias y secretos.
- [ ] Pruebas de permisos, aislamiento y concurrencia.
- [ ] Pruebas de accesibilidad y rendimiento.
- [ ] Restauración de copia de seguridad.
- [ ] Monitorización y alertas.
- [ ] Revisión de privacidad y operaciones.
- [ ] Revisión de seguridad independiente.

No marcar una fase como completada si quedan criterios críticos pendientes.
