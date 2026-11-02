# Galpón Mates — Diseño del backend (NestJS hexagonal)

| | |
|---|---|
| **Fecha** | 2026-10-20 |
| **Estado** | Aprobado por Lucas el 2026-11-02 ("sí, tal cual"). Implementación por piezas desde B1 |
| **Repo** | `LucasGonzalezRighi/Galp-nMatesE-comersBack-end` (carpeta `E-comers Marcos/backend/`). La base de datos (schema, migraciones, seed, Docker) vive dentro de este repo. Este documento se copia ahí al crearlo |
| **Contrato con el front** | `frontend/docs/api/openapi.yaml`: el back lo implementa tal cual |
| **Spec del front** | `frontend/docs/superpowers/specs/2026-10-19-galpon-frontend-design.md` |

---

## 1. Objetivo y principios

Una API REST que sostenga la tienda y el dashboard de Galpón Mates. Se va a usar todos los días, así que prioriza tres cosas:

1. **Desacople** (arquitectura hexagonal). El negocio no depende de NestJS, Prisma, Mercado Pago ni Redis. Cambiar un proveedor (por ejemplo, sumar Stripe) es escribir un adaptador nuevo, sin tocar el núcleo.
2. **Correctitud en el dinero.** Pedidos y pagos idempotentes, stock sin sobreventa, montos en pesos enteros y transacciones claras.
3. **Liviano de operar.** Un solo servicio (monolito modular), PostgreSQL y Redis: nada más.

## 2. Decisiones (Lucas, 2026-10-20)

| Tema | Decisión |
|---|---|
| Framework | NestJS (TypeScript) |
| Arquitectura | Hexagonal (puertos y adaptadores), en un **monolito modular**: un módulo por área de negocio |
| Base de datos | PostgreSQL |
| ORM | Prisma, solo en los adaptadores de infraestructura |
| Colas, caché y sesiones | Redis + BullMQ |
| Pagos | Mercado Pago en la V1. Stripe más adelante, por el mismo puerto `PaymentGateway` |
| API | REST, prefijo `/api/v1`, documentada con Swagger (OpenAPI 3.1) |
| Tipado front ↔ back | Contrato OpenAPI compartido. El front genera sus tipos de ese contrato, y un test del back verifica que el Swagger que genera Nest sea igual |

## 3. Arquitectura

### 3.1 Capas de cada módulo

```
            ┌───────────────────────────────────────────────┐
  HTTP ───► │ interface/   controllers REST + DTOs (Swagger)│
  Colas ──► │              consumers BullMQ                 │
            ├───────────────────────────────────────────────┤
            │ application/ casos de uso (commands/queries)  │
            │              puertos: interfaces que el caso  │
            │              de uso necesita (repos, gateways)│
            ├───────────────────────────────────────────────┤
            │ domain/      entidades, value objects, reglas │ ◄─ TypeScript puro:
            │              y eventos de dominio             │    sin Nest ni Prisma
            ├───────────────────────────────────────────────┤
            │ infrastructure/ adaptadores que implementan   │
            │              los puertos: Prisma, Mercado     │
            │              Pago, Redis, Cloudinary, email   │
            └───────────────────────────────────────────────┘
```

**Regla de dependencias** (la controla `eslint-plugin-boundaries` o `dependency-cruiser` en CI):
- `domain` no importa nada externo.
- `application` importa solo `domain` y define los puertos.
- `infrastructure` implementa esos puertos.
- `interface` llama a `application`.
- Nest conecta puertos con adaptadores por inyección (tokens), en el `*.module.ts` de cada módulo.

### 3.2 Módulos

| Módulo | Responsabilidad | Adaptadores de salida |
|---|---|---|
| `identity` | Usuarios, clientes, admin, sesiones, CSRF, recuperación de contraseña | Prisma, Redis (sesiones), email |
| `catalog` | Líneas, productos, fotos, stock y reservas, búsqueda | Prisma, Redis (caché) |
| `pricing` | Cotización del carrito y del kit (reglas del spec del front §8) | — (usa puertos de `catalog` y `settings`) |
| `orders` | Pedidos, ítems con copia de precios, estados, envío, expiración | Prisma, BullMQ |
| `payments` | Intentos de pago, webhooks, devoluciones, tarjetas guardadas | Mercado Pago (V1), Stripe (después), Prisma |
| `reviews` | Reseñas, moderación, "compra verificada" | Prisma |
| `support` | Contacto y botón de arrepentimiento (código de trámite) | Prisma, email |
| `content` | Contenidos editables y ajustes | Prisma, Redis (caché) |
| `media` | Firma de subidas a Cloudinary | Cloudinary |
| `storefront-sync` | Avisa a la tienda qué páginas regenerar (`/api/revalidate`) | HTTP |
| `shared` | Núcleo compartido: dinero (`Pesos`), errores, eventos, reloj, IDs, idempotencia, outbox | Prisma, Redis |

**Comunicación entre módulos:**
- **Lecturas síncronas**, solo a través de puertos públicos. Por ejemplo, `orders` pide precios con `PricingPort` y nunca toca las tablas de `catalog`.
- **Efectos asíncronos**, con eventos de dominio. Se guardan en `outbox_events` dentro de la misma transacción, un relay los publica en BullMQ y los handlers son idempotentes.
- **Eventos principales:** `OrderPlaced`, `OrderExpired`, `PaymentApproved`, `PaymentRejected`, `PaymentRefunded`, `ProductChanged`, `ContentChanged`, `ReviewSubmitted`, `WithdrawalRequested`.

### 3.3 Estructura del repo

```
backend/
├─ src/
│  ├─ main.ts                 Arranque: Swagger, helmet, filtro problem+json, validación
│  ├─ app.module.ts
│  ├─ config/                 Variables de entorno validadas con Zod al arrancar
│  ├─ shared/
│  │  ├─ domain/              Pesos, Result, DomainError, DomainEvent, Clock, Id
│  │  └─ infrastructure/      PrismaService, Redis, outbox relay, idempotencia, filtro de errores,
│  │                          guards de sesión/CSRF/rol, rate limiting, logger (pino)
│  └─ modules/
│     └─ orders/              (igual en cada módulo)
│        ├─ domain/           order.entity.ts, order-status.ts, order.events.ts, *.spec.ts
│        ├─ application/
│        │  ├─ ports/         order.repository.port.ts, pricing.port.ts, stock.port.ts
│        │  ├─ commands/      place-order.command.ts (+ handler + spec)
│        │  └─ queries/       get-order.query.ts
│        ├─ infrastructure/   prisma-order.repository.ts, order.mapper.ts
│        ├─ interface/        orders.controller.ts, dto/*.dto.ts, order-expiration.consumer.ts
│        └─ orders.module.ts
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts                 Carga los datos del diseño (fixtures exportados por el front)
├─ test/
│  ├─ e2e/                    HTTP con supertest contra Postgres + Redis reales (Testcontainers)
│  └─ contract/               Swagger generado vs. openapi.yaml del front; casos de validación compartidos
├─ docker-compose.yml         postgres + redis para desarrollo
└─ README.md
```

## 4. Modelo de datos

Convenciones:
- IDs `uuid` v7, generados por la app: ordenables por tiempo y sin exponer cuántos registros hay.
- Montos `integer` en pesos enteros, con sufijo `_ars`.
- Fechas `timestamptz` en UTC.
- Enums de Postgres.
- `created_at` y `updated_at` en todas las tablas que cambian.
- Las tablas están en `snake_case`; Prisma las mapea a `camelCase`.

### 4.1 Identidad

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `users` | id, email (citext), password_hash (argon2id), role (`customer`\|`admin`), status (`active`\|`disabled`), email_verified_at, last_login_at | `email` único |
| `customers` | id, user_id (null), email (citext), first_name, last_name, phone, document_type, document_number | `email` único; `user_id` único. **Es la persona que compra.** Un invitado también es un `customer` sin `user_id`; si después se registra con el mismo email, se vincula. Así todas sus compras quedan asociadas a la persona |
| `addresses` | id, customer_id, label, street, number, apartment, postal_code, city, province (enum de 24), is_default | FK `customer_id`; índice único parcial `(customer_id) WHERE is_default` |
| `password_reset_tokens` | id, user_id, token_hash, expires_at, used_at | `token_hash` único |

Las sesiones van en **Redis** (TTL de 8 h para el admin y 30 días para clientes), con cookie `__Host-` `httpOnly`. No hay tabla de sesiones.

### 4.2 Catálogo y stock

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `categories` | id, slug, name, group (`mate`\|`bombilla`\|`yerba`), blurb, image_id, position | `slug` único |
| `products` | id, sequence (correlativo, genera el código "N°07"), slug, category_id, name, description, price_ars (null = a consultar), status (`draft`\|`published`\|`archived`), featured, tabs_override (jsonb), published_at | `slug` único, `sequence` único; índice `(status, category_id)` |
| `product_slug_history` | slug, product_id | `slug` único (redirección de slugs viejos) |
| `media_assets` | id, provider, public_id, url, width, height, alt | `public_id` único (fotos de productos, líneas y socios) |
| `product_images` | product_id, media_asset_id, position | PK `(product_id, position)` |
| `inventory` | product_id (PK), on_hand, reserved, version | CHECK `0 ≤ reserved ≤ on_hand`. Disponible = `on_hand − reserved`. `version` sirve para bloqueo optimista |
| `stock_reservations` | id, order_id, product_id, quantity, status (`active`\|`committed`\|`released`), expires_at | índice `(status, expires_at)` |

Los cueros y las virolas son listas fijas del dominio, no tablas: se guardan como elección dentro de cada ítem del pedido.

### 4.3 Pedidos

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `orders` | id, number (`GLP-12345`), customer_id, status (enum del contrato), payment_status (enum normalizado), contact_email, contact_first_name, contact_last_name, contact_phone, shipping_method, shipping_address (jsonb, copia), shipping_cost_ars, items_gross_ars, kit_savings_ars, subtotal_ars, total_ars, kit_discount_percent (copia), access_token_hash (invitados), reserved_until, placed_at, paid_at, cancelled_at | `number` único; índices `(customer_id, placed_at)` y `(status, reserved_until)` |
| `order_items` | id, order_id, line_type (`product`\|`kit`), product_id (null en kits), name, detail, quantity, unit_price_ars, kit_savings_ars, total_ars, options (jsonb: cuero y virola), position | FK `order_id`. **Todo se copia al comprar**: si después cambia el precio o el nombre, el pedido no se altera |
| `order_item_components` | order_item_id, role (`mate`\|`bombilla`\|`yerba`), product_id, name, unit_price_ars | PK `(order_item_id, role)` (las 3 piezas de un kit) |
| `order_status_history` | id, order_id, from_status, to_status, actor (`system`\|`admin`\|`customer`\|`provider`), note, created_at | índice `(order_id, created_at)` |
| `shipments` | order_id (PK), carrier, tracking_number, shipped_at, delivered_at | — |

### 4.4 Pagos

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `payments` | id, order_id, provider (`mercadopago`\|`stripe`), method (`mp_redirect`\|`card`), status (enum normalizado), provider_status, status_detail, provider_payment_id, provider_preference_id, amount_ars, installments, payment_type_id, card_brand, card_last_four, payment_method_id (tarjeta guardada, null), idempotency_key, is_active, approved_at | `idempotency_key` único; **único parcial `(order_id) WHERE is_active`**: un solo intento activo por pedido, garantizado por la base; único `(provider, provider_payment_id)` |
| `payment_methods` | id, customer_id, provider, provider_customer_id, provider_payment_method_id, brand, last_four, exp_month, exp_year, is_default, deleted_at | único `(provider, provider_payment_method_id)`. **Tarjetas asociadas a la persona: solo tokens del proveedor, nunca el número.** En la V1 cada pago registra marca y últimos 4 (las compras quedan asociadas a la tarjeta); guardar tarjetas para recompra se habilita con esta misma tabla |
| `refunds` | id, payment_id, provider_refund_id, amount_ars, status, reason | `provider_refund_id` único |
| `webhook_events` | id, provider, event_id, type, resource_id, signature_valid, payload (jsonb), received_at, processed_at, attempts, last_error | **único `(provider, event_id)`**: un aviso repetido no se procesa dos veces |
| `idempotency_keys` | scope, key, request_hash, status (`processing`\|`completed`), response_status, response_body (jsonb), locked_until, expires_at | PK `(scope, key)` |

### 4.5 Comunidad, soporte y plataforma

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `reviews` | id, product_id, customer_id (null), order_item_id (null; si existe, es "compra verificada"), author_name, rating (CHECK 1–5), text, status (`pending`\|`approved`\|`hidden`), featured, moderated_at | índice `(product_id, status)` |
| `contact_messages` | id, kind (`contact`\|`withdrawal`), name, email, order_id (null), order_number, reason, message, code (código de arrepentimiento), read_at | `code` único |
| `content_blocks` | key (`home`, `about`, `faq`, `footer`, `product-tabs`, `legal-terms`, `legal-privacy`), data (jsonb validado por el schema de cada contenido), version, updated_by | PK `key` |
| `settings` | id = 1 (fila única), kit_discount_percent, installments_max, installments_show_on_product, contact_email, low_stock_threshold, vat_rate_percent, show_net_price, seller (jsonb) | CHECK `id = 1` |
| `shipping_options` | method (PK), label, cost_ars, eta, enabled | — |
| `outbox_events` | id, aggregate_type, aggregate_id, type, payload (jsonb), occurred_at, published_at, attempts | índice parcial `WHERE published_at IS NULL` |
| `audit_logs` | id, actor_user_id, action, entity_type, entity_id, changes (jsonb), created_at | índice `(entity_type, entity_id)` |

### 4.6 Relaciones

```
users 1─0..1 customers 1─N addresses
                    │ 1─N payment_methods
                    └ 1─N orders 1─N order_items 1─N order_item_components
                              │ 1─N payments 1─N refunds
                              │ 1─N order_status_history
                              │ 1─0..1 shipments
                              └ 1─N stock_reservations N─1 products
categories 1─N products 1─N product_images N─1 media_assets
products 1─1 inventory · products 1─N reviews 0..1─1 order_items
```

## 5. Idempotencia y concurrencia

1. **Header `Idempotency-Key`** (UUID) obligatorio en `POST /orders` y en los dos endpoints de pago. Un interceptor:
   - registra `(scope, key, request_hash)` con `INSERT … ON CONFLICT`;
   - si la misma clave llega con otro cuerpo → `422`;
   - si llega mientras se procesa → `409`;
   - si ya se completó → devuelve **la misma respuesta guardada**.
   - Las claves vencen a las 24 h.
2. **Base de datos como última garantía.** Únicos en `orders.number`, `payments.idempotency_key`, `(provider, provider_payment_id)`, `(provider, event_id)` y "un pago activo por pedido".
3. **Stock sin sobreventa.** Al crear el pedido, en una transacción: `UPDATE inventory SET reserved = reserved + q WHERE product_id = … AND on_hand − reserved ≥ q`. Si no actualiza ninguna fila → `409 stock_changed`. Se crea la reserva con `expires_at = ahora + 30 min`.
4. **Expiración.** Un job diferido de BullMQ en `reserved_until` libera la reserva, pasa el pedido a `expired` y cancela la preferencia de Mercado Pago. Si el pago se aprueba antes, la reserva pasa a `committed` y `on_hand` baja.
5. **Mercado Pago:**
   - Cada intento manda `X-Idempotency-Key` igual a `payments.idempotency_key`.
   - El webhook se verifica con la firma `x-signature`, se guarda en `webhook_events` (duplicado = se ignora) y se procesa en cola: se consulta el pago a MP y se actualiza el estado.
   - Un segundo pago aprobado para un pedido ya pagado se marca para devolución y genera una alerta en el admin.

## 6. Redis

| Uso | Detalle |
|---|---|
| Colas (BullMQ) | `outbox`, `payment-webhooks`, `order-expiration` (jobs diferidos), `notifications` (emails), `storefront-revalidate`. Reintentos con backoff exponencial y cola de fallidos |
| Sesiones | Clave `session:{id}` con TTL; el token CSRF va ligado a la sesión |
| Caché | Lecturas públicas (catálogo, contenidos, ajustes) con invalidación por evento |
| Rate limiting | `@nestjs/throttler` con almacenamiento en Redis (login, formularios públicos, creación de pedidos) |

Redis no es fuente de verdad de nada que no se pueda reconstruir: los pedidos y pagos viven en Postgres.

## 7. API

- Implementa **exactamente** `frontend/docs/api/openapi.yaml`, incluidas las rutas, los nombres de campos, `problem+json` y la paginación.
- Swagger UI en `/api/docs`: abierto en desarrollo, protegido por sesión de admin en producción.
- **Test de contrato** (CI): genera el documento de Swagger y lo compara, normalizado, con el `openapi.yaml` del front. Si difieren, falla.
- **Validación**: DTOs con `class-validator`, decorados para Swagger. Las reglas son las de la sección 15 del spec del front. `docs/api/validation-cases.json` (los generan los tests del front) se corre también en el back, así las mismas entradas dan los mismos errores en los dos lados.

## 8. Seguridad

- **Credenciales:** contraseñas con argon2id; cookies `__Host-` `httpOnly` `Secure` `SameSite=Lax`; CSRF con token ligado a la sesión.
- **Abuso y cabeceras:** rate limiting, helmet, y CORS solo para el origen del admin (la tienda llega por su propio dominio).
- **Pagos:** webhooks con firma verificada. Nunca se reciben ni guardan datos de tarjeta: solo tokens (alcance PCI SAQ-A).
- **Configuración:** variables de entorno validadas al arrancar; secretos solo en el entorno.
- **Logs y auditoría:** logs estructurados con `pino`, con datos personales y tokens enmascarados. `audit_logs` registra cada acción del admin.

## 9. Pruebas

| Nivel | Qué |
|---|---|
| Dominio | Entidades y reglas en TypeScript puro, sin Nest |
| Aplicación | Casos de uso con adaptadores en memoria que implementan los puertos |
| Infraestructura | Repositorios Prisma contra Postgres real (Testcontainers) |
| E2E | HTTP con supertest: compra completa, idempotencia (doble envío), webhook duplicado, expiración, concurrencia de stock |
| Contrato | Swagger vs. `openapi.yaml` y casos de validación compartidos |

## 10. Versiones de referencia

Verificadas el 2026-10-20; se confirman al instalar.
- NestJS 12.2 (`@nestjs/swagger` 12.0, `@nestjs/bullmq` 12.0, `@nestjs/terminus` 12.1, `@nestjs/throttler` 6.7)
- Prisma 7.10 (estable: el tag `latest` de `prisma` apunta a una RC de la 8, así que no se usa)
- BullMQ 6.3 e ioredis 6.0
- SDK `mercadopago` 3.6 (y `stripe` 23 para la fase posterior)
- pino 10 y argon2 0.45
- PostgreSQL y Redis: la última estable de cada uno al crear el `docker-compose.yml`
- Node 22.18+ (lo exige Prisma 7) o 24

## 11. Orden de construcción, por piezas

| Pieza | Contenido | Listo cuando |
|---|---|---|
| B1 · Base | Repo, Nest, configuración, Docker (Postgres + Redis), Prisma, núcleo compartido, errores `problem+json`, interceptor de idempotencia, outbox + relay, Swagger, health checks | Arranca con `npm run dev`, health en verde, test de contrato corriendo |
| B2 · Catálogo y contenido | Lecturas públicas del contrato, seed con los datos del diseño, caché | Las lecturas de la tienda funcionan contra el back real |
| B3 · Identidad | Clientes, admin, sesiones, CSRF, recuperación de contraseña | Login de admin y de cliente con E2E |
| B4 · Pedidos y stock | Cotización, creación idempotente, reservas, expiración | E2E de doble envío y de concurrencia |
| B5 · Pagos | Mercado Pago (preferencia, tarjeta, 3-D Secure), webhooks, estados, alertas | Compra completa con el sandbox de MP |
| B6 · Admin | CRUD, firma de Cloudinary, despacho, contenidos, ajustes, revalidación de la tienda | Todo el dashboard funciona contra el back real |
| B7 · Comunidad y soporte | Reseñas con compra verificada, contacto, arrepentimiento con código, emails | E2E de cada formulario |
| B8 · Producción | Hardening, observabilidad, backups, guía de deploy | Checklist de deploy aprobado |

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Que el contrato y la implementación se separen | Test de contrato en CI de los dos repos |
| Doble cobro o pedidos duplicados | Idempotencia en capas: header, únicos en la base y "un intento activo" |
| Sobreventa con muchos compradores al mismo tiempo | `UPDATE` condicional + reservas con vencimiento |
| Avisos de Mercado Pago perdidos o repetidos | Tabla de eventos única + cola con reintentos + conciliación al consultar el pedido |
| Sobrecarga de diseño para una tienda chica | Monolito modular: hexagonal en el código, operación simple |
