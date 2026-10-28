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

**Puerta de salida:** las pruebas negativas de aislamiento pasan y el proyecto compila. — Superada el 2026-10-22; CI de GitHub en verde desde el 2026-10-23.

## Fase 2 — Interfaz y configuración
- [x] Layout responsive y navegación: barra lateral con secciones y locales, menú en móvil, sin desbordes a 390 px (D-027).
- [x] Selector de organización (cambio en la cabecera) y de establecimiento (tarjetas de la portada).
- [x] Configuración de horarios y zona horaria (horario semanal, turnos nocturnos, excepciones, cálculo con DST).
- [x] Edición de los datos del establecimiento desde la interfaz.
- [x] Dashboard con datos reales y estados vacíos (D-024).
- [x] Páginas largas organizadas en apartados con enlace propio: local, editor de carta, inventario y web pública (D-028).
- [x] Navegación por local: cartas, inventario y compras dentro de cada local, selector de local; catálogo común (productos, ingredientes, proveedores) y vistas del grupo (D-030).

## Fase 3 — Cartas digitales
- [x] Categorías y productos (catálogo por organización, categorías por carta, precio específico por carta).
- [x] Editor y ordenación (interfaz básica de formularios).
- [x] Temas Moderno, Clásico, Futurista y Mediterráneo (estilos básicos; diseño a refinar).
- [x] Borradores y publicación atómica.
- [x] Versiones (historial, reactivar, despublicar).
- [x] Página pública (solo versión publicada).
- [x] QR SVG/PNG con enlace corto estable (D-013).
- [x] Idiomas y alérgenos — alérgenos UE; traducción manual de cartas y web a inglés, francés, alemán, italiano, portugués y catalán (D-033). Pendiente: traductor automático (adaptador) y reserva online traducida.
- [x] Productos disponibles por local: cada carta solo ofrece los productos disponibles en su local (D-032).
- [x] Marca de la web: logotipo, color propio y 4 tipografías por estilo (D-034).
- [x] Carta en papel: página para imprimir o guardar como PDF (publicada o borrador, alérgenos, descripciones, QR, 1 o 2 columnas).
- [x] Pruebas de aislamiento y publicación (integración, concurrencia y E2E).
- [x] Fotos de platos y marca «recomendado» (migración 0013, D-021).
- [x] Web pública del local `/<org>/<local>` con los temas Futurista, Clásico y Mediterráneo (portada, carta destacada con pestañas y carrusel, destacados, contacto y horario reales, navegación inferior en móvil).
- [x] Mismo diseño en la carta completa `/m/...` (fotos, recomendados, pestañas fijas por categoría) y en la página de reservas `/r/...` cuando el local tiene su web publicada (D-022).

## Fase 4 — Inventario
- [x] Ingredientes y unidades (g/ml/unidades con conversión kg, l, cl).
- [x] Almacenes y movimientos (entradas, consumos, mermas, ajustes, correcciones, traspasos y recuentos físicos; D-025).
- [x] Recetas y escandallos (coste por ración, margen, % coste, alérgenos derivados, elaboración que descuenta stock).
- [x] Proveedores y órdenes de compra.
- [x] Recepciones y alertas (recepciones parciales/totales idempotentes; alerta de stock bajo mínimo).
- [x] Pruebas de concurrencia e idempotencia.

## Fase 5 — Mesas y reservas
- [x] Zonas y plano (cuadrícula editable arrastrando o con teclado).
- [x] Mesas y capacidades (sin solapes garantizado en BD).
- [x] Horarios y excepciones (hechos en Fase 2; ver D-011).
- [x] Calendario (vista por día con navegación y ocupación a una hora sobre el plano).
- [x] Reservas públicas y privadas (online con asignación automática de mesa, límites de peticiones e idempotencia).
- [x] Asignaciones y prevención de solapamientos (exclusión en BD, combinación de mesas).
- [x] Lista de espera (interna; D-026). Alta desde la web pública pendiente.
- [x] Pruebas de concurrencia.

## Fase 6 — Personal, clientes e informes
- [ ] Gestión de miembros y turnos — hecho: miembros limitados a locales concretos (D-031); pendientes turnos y horarios del personal.
- [ ] CRM opcional con minimización de datos.
- [ ] Informes operativos — hecho: estadísticas de visitas (web, cartas, QR) y resumen de reservas por local (D-029); pendientes informes de inventario y compras.
- [ ] Exportaciones seguras.

## Fase 7 — Suscripciones e integraciones
- [ ] Evaluar proveedor de suscripción.
- [ ] Configurar correo u otros proveedores necesarios.
- [ ] Implementar y verificar integraciones reales.
- [ ] Mantener desactivadas funciones no configuradas.

## Fase 8 — Preparación para producción
- [x] CI en GitHub (lint, tipos, unitarias, integración, E2E y construcción de imágenes) ejecutándose en cada push.
- [x] Imágenes Docker (web sin privilegios y herramientas), comprobación de salud y manual de despliegue (`docs/DEPLOYMENT.md`, D-023); ensayo local en contenedores superado.
- [ ] Elegir hosting, PostgreSQL gestionado, dominio y almacenamiento de fotos.
- [x] Límites de intentos por IP en login y registro.
- [ ] Revisar OWASP ASVS aplicable.
- [ ] Ejecutar análisis de dependencias y secretos.
- [ ] Pruebas de permisos, aislamiento y concurrencia.
- [ ] Pruebas de accesibilidad y rendimiento.
- [ ] Restauración de copia de seguridad.
- [ ] Monitorización y alertas.
- [ ] Revisión de privacidad y operaciones.
- [ ] Revisión de seguridad independiente.

No marcar una fase como completada si quedan criterios críticos pendientes.
