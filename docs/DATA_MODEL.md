# Modelo de datos — borrador inicial

El modelo final debe diseñarse y migrarse de forma versionada. Este documento no sustituye las migraciones: la fuente de verdad es `db/migrations/`.

**Implementado (migración 0001):** `users`, `sessions`, `auth_login_attempts`, `organizations`, `memberships` (roles tipados owner/admin/manager/staff), `establishments`, `audit_events`. El resto de tablas de este documento siguen siendo un borrador.

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
