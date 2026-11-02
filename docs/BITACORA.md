# Bitácora del backend

Registro de lo que se construyó en cada pieza del back (spec §11), las decisiones que se tomaron
en el camino y lo que queda. Las decisiones de arquitectura más grandes están en `docs/adr/`.

## B1 · Base y B2 · Catálogo y contenido (2026-11-02)

Plan: [`docs/superpowers/plans/2026-11-02-b1-base-b2-catalogo.md`](superpowers/plans/2026-11-02-b1-base-b2-catalogo.md)
(10 tareas). Rulings de Lucas: repo nuevo `backend/` con la spec del 2026-10-20 tal cual; primera
entrega = B1 + B2 (la tienda lee contra el back real en `:3001`); puertos tienda 3000, admin 5173,
back 3001; CORS con credenciales solo para `http://localhost:5173`.

### Qué quedó

**B1 · Base**

- Esqueleto NestJS 12 (CommonJS), TypeScript 6 estricto, ESLint 10 con fronteras hexagonales
  (`eslint-plugin-boundaries`), Prettier, lefthook, vitest 5 con SWC, versiones exactas verificadas
  por `scripts/check-dependency-versions.mjs`.
- Configuración validada con zod al arrancar (`ENV`), con errores en español que no muestran
  secretos; logger pino (`nestjs-pino`) con cookies y `authorization` enmascarados.
- Docker Compose con Postgres 17 y Redis 8; Prisma 7.10.1 con el driver adapter `pg`
  ([ADR 0002](adr/0002-prisma-7-driver-adapter-pg.md)); esquema de catálogo, contenido, reseñas,
  ajustes, envíos, outbox e idempotencia, con `CHECK`s e índices en SQL.
- Redis (ioredis 6) con caché que **falla abierta**, rate limiting global (120/min por IP) con
  almacenamiento en Redis que cae a memoria si Redis no responde, y `/health` con Terminus
  (`database` crítico → 503; `redis` → `degraded`, HTTP 200).
- Núcleo compartido: `Pesos` (enteros, redondeo como el front), `DomainError`, `Result`, `Clock`,
  ids UUID v7; filtro `problem+json` global y pipe de validación (422 con `errors[]`
  `{ field, code, message }`); interceptor de idempotencia (`@Idempotent`, `Idempotency-Key`:
  misma respuesta, 409 en curso, 422 con otro cuerpo) y outbox con relay a BullMQ.
- Swagger (OpenAPI 3.1) en `/api/docs` fuera de producción y **test de contrato** contra el
  `openapi.yaml` del front (`npm run contract:check`, `scripts/openapi-diff.mjs`).
- CORS solo para `ADMIN_ORIGIN` con credenciales (cerrado en la Task 10).
- CI en GitHub Actions y test negativo de fronteras (Task 10).

**B2 · Catálogo y contenido**

- Seed idempotente con los datos del diseño (fixtures del front importadas a `prisma/seed-data/`):
  6 líneas, 27 productos, 15 reseñas, 7 contenidos, ajustes y 3 envíos.
- Módulos `catalog`, `content`, `reviews` (lectura) y `settings` (público), con casos de uso,
  puertos, repositorios Prisma y caché read-through en Redis (`catalog:*` 60 s, `content:*` y
  `settings:store` 300 s; las reseñas no se cachean).
- Las **13 lecturas públicas** del contrato, idénticas al contrato según `contract:check`:
  `GET /categories`, `/products`, `/products/{slug}`, `/products/{slug}/related`,
  `/products/{slug}/reviews`, `/reviews/featured`, `/content/{home,about,faq,footer,product-tabs}`,
  `/content/legal/{document}` y `/settings/public`. Sin límite por IP (la tienda lee desde un
  solo servidor).

### Decisiones tomadas en el camino

- **Capas sin Nest en `application`:** los casos de uso no llevan `@Injectable()`; se registran
  con `useFactory` en el `*.module.ts`. `interface` solo usa la infraestructura compartida
  ([ADR 0001](adr/0001-nest-hexagonal-monolito.md)).
- **`Problem.type` en `snake_case`** (`not_found`, `validation_error`, …) y `errors[]` con `code`,
  como el contrato (el plan proponía URLs y `{ field, message }`).
- **`/health` fuera del contrato:** su 503 sale con el informe de Terminus, no como `Problem`.
- **Reseñas `verified_purchase`:** columna propia (la fija el seed; desde B4 se deriva de
  `order_item_id`), en vez de dejar `false` hasta B4.
- **Descuentos:** `Pesos.percentOf` redondea el ahorro (como `kitSavings` del front) y el total es
  monto − ahorro.
- **Búsqueda `q`** sin acentos ni mayúsculas sobre nombre, descripción y línea (como el contrato y
  el mock); **orden A-Z** con `COLLATE "es-x-icu"`; **relacionados**: misma línea primero y
  después el mismo grupo; `isPurchasable` exige precio (los "a consultar" no se compran).
- **`/content/legal/otro` → 404** (no 422): el contrato solo declara 200/404/429/500 ahí.
- **Robustez de `/products`:** `page` enorme → `OFFSET` `bigint` o página vacía con el total
  real; `NUL` en `q`/`category` → lista vacía sin consultar la base. Nunca 500.
- **Lecturas públicas con `@SkipThrottle()`:** el `next build` de la tienda pide las 27 fichas
  desde una sola IP. El `POST` de reseñas (B7) tiene que reponer el límite.
- **`forbidNonWhitelisted`** también en queries: un parámetro que no está en el contrato da 422.
- **Fronteras:** la regla es `boundaries/dependencies` (desde la 6 del plugin reemplaza a
  `element-types`, que queda como alias obsoleto).

### Versiones reales instaladas

Todas las del plan, sin cambios salvo las anotadas.

| Paquete                                                                               | Versión                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `@nestjs/common`, `core`, `platform-express`, `testing`                               | 12.3.2                                                            |
| `@nestjs/swagger` / `config` / `terminus` / `bullmq` / `cli`                          | 12.1.0 / 12.0.1 / 12.1.0 / 12.0.0 / 12.0.11                       |
| `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` (con `overrides` a Nest 12) | 6.7.1 + 1.2.0                                                     |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg`                                      | 7.10.1                                                            |
| `pg` / `@types/pg`                                                                    | 8.23.1                                                            |
| `bullmq` / `ioredis`                                                                  | 6.5.3 / 6.0.0                                                     |
| `pino` / `nestjs-pino` / `pino-http` (peer de nestjs-pino)                            | 10.4.0 / 5.3.1 / 11.0.0                                           |
| `zod` / `helmet` / `uuid`                                                             | 4.6.7 / 8.3.0 / 14.0.3                                            |
| `class-validator` / `class-transformer`                                               | 0.15.1 / 0.5.1                                                    |
| `reflect-metadata` / `rxjs`                                                           | 0.2.2 / 7.8.2                                                     |
| `typescript`                                                                          | 6.0.3                                                             |
| `vitest` + `unplugin-swc` + `@swc/core`                                               | 5.0.5 + 2.0.0 + 1.16.21                                           |
| `supertest` / `@types/supertest`                                                      | 7.3.1 / 7.2.1                                                     |
| `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/redis`               | 12.2.1                                                            |
| `eslint` / `@eslint/js` / `typescript-eslint` / `eslint-plugin-boundaries`            | 10.14.0 / 10.0.1 / 8.72.1 / 7.4.1                                 |
| `eslint-config-prettier` / `prettier` / `lefthook`                                    | 10.1.8 / 3.9.10 / 2.2.2                                           |
| `tsx` / `yaml`                                                                        | 4.23.15 / 2.9.1                                                   |
| `@types/node` / `@types/express`                                                      | 22.20.5 / 5.0.6                                                   |
| Imágenes Docker (compose y Testcontainers) / CI                                       | `postgres:17-alpine`, `redis:8-alpine` / `postgres:17`, `redis:8` |

Fuera del plan: `ioredis`, el throttler y su storage entraron en la Task 1; `pg`, `tsx` y
`@types/pg` en la Task 3; `pino-http` 11 es el peer de `nestjs-pino` 5.3.1. `@nestjs/config` está
instalado pero sin uso (el `ConfigModule` es propio, con zod). Node de la máquina: 22.20.0
(`@nestjs/cli` avisa `EBADENGINE`: pide ≥ 22.22.3; todo funciona igual). `npm audit`: 22
vulnerabilidades moderadas transitivas, sin revisar.

### Estado de la verificación al cierre

- En verde: `npm run typecheck`, `npm run lint` (fronteras), `npm run format:check`, `npm test`
  (23 archivos, 142 tests) y `npm run contract:check` (13 operaciones idénticas, 64 pendientes).
- **`npm run test:e2e` no corre desde la Task 5:** Docker Desktop 4.47 no levanta el motor
  (al iniciar el "Inference manager" no puede borrar un socket viejo, `dockerInference`: "The file
  cannot be accessed by the system"). Pasa solo el contrato; los 7 archivos con
  Testcontainers fallan en `beforeAll` (`Could not find a working container runtime strategy`).
  Sin ejecutar contra Postgres real: `public-reads`, `catalog.repository` (`es-x-icu`,
  `ANY(uuid[])`, `OFFSET bigint`), el `health` con Postgres caído, el seed con `verified_purchase`
  y la prueba de la tienda contra el back. **Arreglo (Lucas):** con Docker Desktop cerrado, borrar
  `%LOCALAPPDATA%\Docker\run\dockerInference` (y `userAnalyticsOtlpHttp.sock` si también molesta)
  o reiniciar Windows, abrir Docker Desktop y correr `npm run test:e2e` y la prueba del README.

### Commits

| Commit    | Qué                                                                                   |
| --------- | ------------------------------------------------------------------------------------- |
| `873868a` | Esqueleto de NestJS 12 con calidad, vitest y health (Task 1)                          |
| `dbc040b` | `strict` completo y tsconfig/eslint listos para Prisma (fix Task 1)                   |
| `c70e68b` | Configuración validada con zod y logger pino (Task 2)                                 |
| `742b9dc` | Prisma 7, Postgres y Redis en Docker, esquema de catálogo y contenido (Task 3)        |
| `141863b` | Redis, caché que falla abierta, rate limiting y health con Terminus (Task 4)          |
| `2203de4` | Indicador de Postgres en `/health` y arranque que falla sin base (fix Tasks 2-4)      |
| `ae32167` | Seed idempotente con los datos del diseño (Task 7)                                    |
| `ba68f40` | Swagger en `/api/docs` y test de contrato (Task 6)                                    |
| `18a59d3` | Núcleo compartido: pesos, `problem+json`, idempotencia y outbox (Task 5)              |
| `9d3d7e8` | `verified_purchase` en reseñas y redondeo del descuento como el front (fix Tasks 5-7) |
| `3f9d033` | Módulos de catálogo, contenido, reseñas y ajustes con lecturas cacheadas (Task 8)     |
| `917449d` | Sin 500 en `GET /products` con `page` enorme o `NUL` en la búsqueda (fix Task 8)      |
| `d81d708` | Lecturas públicas del contrato (Task 9)                                               |
| `ecfc554` | Lecturas públicas fuera del límite por IP (fix Task 9)                                |
| Task 10   | Fronteras con test negativo, CORS del admin, CI, esta bitácora, ADRs y README         |

### Lo que queda para B3 en adelante

**Piezas siguientes** (spec §11): B3 identidad (clientes, admin, sesiones, CSRF, recuperación de
contraseña), B4 pedidos y stock (cotización, creación idempotente, reservas, expiración), B5 pagos
con Mercado Pago, B6 admin (CRUD, Cloudinary, despacho, revalidación de la tienda), B7 comunidad y
soporte (reseñas con compra verificada, contacto, arrepentimiento, emails) y B8 producción.

**Deuda y avisos que dejaron B1 y B2:**

- Correr `npm run test:e2e` y la prueba de la tienda en cuanto Docker funcione (ver arriba).
- Invalidar la caché al escribir (B6/B7): `catalog:*` (el rating vive ahí), `content:{key}` y
  `settings:store`.
- `POST /products/{slug}/reviews` (B7) tiene que reponer el rate limit
  (`@SkipThrottle({ default: false })`), porque el controlador de reseñas lo saltea a nivel clase.
- DTOs con booleanos en cuerpos (B3+): `@Transform` explícito, porque `enableImplicitConversion`
  convierte `"false"` en `true`.
- Comparar también `requestBody`, `security` y cabeceras en el test de contrato cuando lleguen las
  escrituras.
- Producción (B8): `trust proxy` para que el rate limiting vea la IP real,
  `connectionTimeoutMillis` en el pool de `pg`, Swagger protegido por sesión de admin, `npm audit`.
- Menores anotados en las revisiones: mensajes en inglés del framework en algunos `detail`
  (body-parser, `Forbidden resource`), cierre del relay del outbox con Redis caído desde el
  arranque (sin timeout), caché del catálogo con una forma vieja tras un deploy (atrapar y caer a
  Postgres), cardinalidad de claves con `q`/`ids` libres, `JSON.stringify` dentro del `try` de la
  caché, reseñas paginadas en memoria, e idempotencia con dos pedidos realmente simultáneos sin
  test.
- `ReviewsController` importa el DTO de slug y el texto de 404 de `catalog/interface`: moverlos a
  `src/shared/infrastructure/http` para no acoplar módulos.
