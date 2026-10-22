# Modelo de datos — borrador inicial

El modelo final debe diseñarse y migrarse de forma versionada. Este documento no sustituye las migraciones: la fuente de verdad es `db/migrations/`.

**Implementado (migración 0001):** `users`, `sessions`, `auth_login_attempts`, `organizations`, `memberships` (roles tipados owner/admin/manager/staff), `establishments`, `audit_events`. Migración 0002: `invitations`. Migración 0003: `opening_hours`, `schedule_exceptions`, `schedule_exception_slots` (sustituyen a `opening_hours`/`schedule_exceptions` del borrador de sala). Migración 0004: `menu_products` (catálogo; equivale a `products` + `product_allergens` del borrador), `menus`, `menu_sections` (las «categorías» de cada carta), `menu_items`, `menu_versions` (instantáneas inmutables; `published_menu_versions` se resuelve con `menus.published_version_id`; el tema vive en `menus.theme` y se congela en la instantánea). Migración 0005: `menus.public_code`. Migración 0006: `ingredients`, `warehouses`, `stock_levels` (solo lo escribe un trigger), `stock_movements` (solo inserción). El resto de tablas de este documento siguen siendo un borrador.

## Núcleo de identidad y organización

- `organizations`
- `establishments` (pertenece a organización)
- `users` o identidad gestionada por el proveedor
- `memberships` (usuario, organización, estado)
- `establishment_memberships` si se necesitan permisos por local
- `roles` y `permissions` o permisos tipados equivalentes
- `invitations` (token protegido/hash, caducidad, un solo uso)
- `audit_events`

## Cartas

- `categories`
- `products`
- `product_translations`
- `product_allergens`
- `menus`
- `menu_items`
- `menu_versions`
- `published_menu_versions`
- `theme_settings`

Definir cómo se comparten productos entre cartas y cómo se representan precios específicos de carta. Publicar una versión consistente y no exponer borradores.

## Inventario

- `ingredients`
- `warehouses`
- `stock_movements`
- `stock_lots` cuando sea necesario
- `recipes`
- `recipe_items`
- `suppliers`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`

Mantener trazabilidad. Evitar que el stock se actualice sin un movimiento correspondiente.

## Sala y reservas

- `zones`
- `tables`
- `table_combinations` o modelo equivalente
- `opening_hours`
- `schedule_exceptions`
- `service_periods`
- `reservations`
- `reservation_table_assignments`
- `waitlist_entries`

Definir intervalos temporales, zona horaria del establecimiento, capacidad, duración y reglas de concurrencia. Evitar asignaciones incompatibles mediante transacciones y restricciones adecuadas.

## Personas e informes

- `employees` o perfiles de personal mínimos
- `staff_shifts`
- `customers` solo si el CRM está habilitado y existe finalidad legítima
- vistas o consultas de informes autorizadas

## Requisitos de esquema

- PK y FK explícitas.
- Índices para consultas frecuentes.
- Restricciones CHECK y UNIQUE apropiadas.
- Relaciones entre entidades de una misma organización protegidas por diseño.
- Política clara de borrado lógico o definitivo.
- Fechas de creación y actualización.
- Auditoría de operaciones sensibles.
- Evitar duplicar datos personales.
