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
| `argon2` / `cookie-parser` / `@types/cookie-parser` (B3, Task 1)                      | 0.45.1 / 1.4.7 / 1.4.10                                           |
| Imágenes Docker (compose y Testcontainers) / CI                                       | `postgres:17-alpine`, `redis:8-alpine` / `postgres:17`, `redis:8` |

Fuera del plan: `ioredis`, el throttler y su storage entraron en la Task 1; `pg`, `tsx` y
`@types/pg` en la Task 3; `pino-http` 11 es el peer de `nestjs-pino` 5.3.1. `@nestjs/config` está
instalado pero sin uso (el `ConfigModule` es propio, con zod). Node de la máquina: 22.20.0
(`@nestjs/cli` avisa `EBADENGINE`: pide ≥ 22.22.3; todo funciona igual). `npm audit`: 22
vulnerabilidades moderadas transitivas, sin revisar. En B3, `argon2` 0.45.1 es la mayor 0.45.x
publicada (también existe `1.0.0-alpha.1`, descartada por ser prerelease) y trae binarios
precompilados (no compila con node-gyp); `@types/cookie-parser` 1.4.10 es la última 1.4.x.

### Estado de la verificación al cierre

- En verde: `npm run typecheck`, `npm run lint` (fronteras), `npm run format:check`, `npm test`
  (23 archivos, 142 tests) y `npm run contract:check` (13 operaciones idénticas, 64 pendientes).
- `npm run test:e2e` en verde (8 archivos, 58 tests y 1 omitido) contra `postgres:17-alpine` y
  `redis:8-alpine` con Testcontainers: `health`, `prisma`, `seed`, `idempotency`, `outbox`,
  `catalog.repository` (`es-x-icu`, `ANY(uuid[])`, `OFFSET bigint`), `public-reads` y el contrato.
  Durante las Tasks 5 a 10 no había corrido: Docker Desktop 4.47 no levantaba el motor porque al
  iniciar el "Inference manager" no podía borrar un socket viejo (`dockerInference`, un punto de
  reanálisis de 0 bytes que ni `del` ni `fsutil` tocan). **Arreglo que funcionó:** con Docker
  Desktop cerrado, renombrar la carpeta entera `%LOCALAPPDATA%\Docker\run` (por ejemplo a
  `run.stale`) y abrir Docker Desktop: el motor levanta en segundos. Si vuelve a pasar, repetir.
- **Prueba de la tienda contra el back (Task 9, paso 4) hecha:** `npm run db:up`, migraciones y
  seed, el back compilado en el 3001 (`/api/v1/health` `ok`, `/api/v1/products?pageSize=50` → 27);
  la tienda compilada en modo `live` (65 páginas; cada ficha pidió su detalle, relacionados y
  reseñas con 200, sin 429) y servida en el 4300: `/` con "Mate Imperial Premium", `/tienda` con
  los 27 productos, `/producto/mate-imperial-premium`, `/kit`, `/nosotros`, `/contacto` y el
  rewrite `/api/v1/products` desde la tienda, todo 200.

### Commits

| Commit    | Qué                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------ |
| `873868a` | Esqueleto de NestJS 12 con calidad, vitest y health (Task 1)                                     |
| `dbc040b` | `strict` completo y tsconfig/eslint listos para Prisma (fix Task 1)                              |
| `c70e68b` | Configuración validada con zod y logger pino (Task 2)                                            |
| `742b9dc` | Prisma 7, Postgres y Redis en Docker, esquema de catálogo y contenido (Task 3)                   |
| `141863b` | Redis, caché que falla abierta, rate limiting y health con Terminus (Task 4)                     |
| `2203de4` | Indicador de Postgres en `/health` y arranque que falla sin base (fix Tasks 2-4)                 |
| `ae32167` | Seed idempotente con los datos del diseño (Task 7)                                               |
| `ba68f40` | Swagger en `/api/docs` y test de contrato (Task 6)                                               |
| `18a59d3` | Núcleo compartido: pesos, `problem+json`, idempotencia y outbox (Task 5)                         |
| `9d3d7e8` | `verified_purchase` en reseñas y redondeo del descuento como el front (fix Tasks 5-7)            |
| `3f9d033` | Módulos de catálogo, contenido, reseñas y ajustes con lecturas cacheadas (Task 8)                |
| `917449d` | Sin 500 en `GET /products` con `page` enorme o `NUL` en la búsqueda (fix Task 8)                 |
| `d81d708` | Lecturas públicas del contrato (Task 9)                                                          |
| `ecfc554` | Lecturas públicas fuera del límite por IP (fix Task 9)                                           |
| Task 10   | `213d7b9` CORS del admin; después, fronteras con test negativo, CI, esta bitácora, ADRs y README |

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
  `connectionTimeoutMillis` en el pool de `pg`, Swagger protegido por sesión de admin, `npm audit`,
  y `ADMIN_ORIGIN` obligatoria (sin el default `http://localhost:5173`) con `NODE_ENV=production`:
  olvidarla habilitaría CORS con credenciales para localhost.
- Menores anotados en las revisiones: mensajes en inglés del framework en algunos `detail`
  (body-parser, `Forbidden resource`), cierre del relay del outbox con Redis caído desde el
  arranque (sin timeout), caché del catálogo con una forma vieja tras un deploy (atrapar y caer a
  Postgres), cardinalidad de claves con `q`/`ids` libres, `JSON.stringify` dentro del `try` de la
  caché, reseñas paginadas en memoria, e idempotencia con dos pedidos realmente simultáneos sin
  test.
- `ReviewsController` importa el DTO de slug y el texto de 404 de `catalog/interface`: moverlos a
  `src/shared/infrastructure/http` para no acoplar módulos.

## B3 · Identidad (2026-11-02)

Plan: [`docs/superpowers/plans/2026-11-02-b3-identidad.md`](superpowers/plans/2026-11-02-b3-identidad.md)
(6 tareas en 5 olas). Decisiones de arquitectura en
[ADR 0003 · sesiones en Redis y CSRF por sesión](adr/0003-sesiones-en-redis-y-csrf-por-sesion.md).

### Qué quedó

- **Esquema** (Task 1):
  - Tablas `users`, `customers`, `addresses` y `password_reset_tokens`, con emails `citext`
    únicos.
  - Índice único parcial `addresses_default_per_customer_idx`: una sola dirección predeterminada
    por cliente.
  - Enum `province` con los 24 textos del contrato.
  - FKs opcionales `reviews.customer_id` y `content_blocks.updated_by`.
  - Migración `20261102194620_b3_identidad`.
  - El seed suma el admin semilla.
- **Sesiones, cookies y guards compartidos** (Task 2, `src/shared`):
  - `SessionPort` con `RedisSessionStore`, que falla cerrado (503).
  - `SecretsPort`.
  - Cookies `__Host-` exactas (`sessionCookie`, `clearedSessionCookie`).
  - Guards de sesión y de CSRF para el cliente y el admin.
  - `Retry-After` en `ProblemFilter`.
  - `cookie-parser`.
  - El test de contrato compara también `security` y `requestBody`.
- **Módulo `identity`** (Tasks 3 a 5):
  - Dominio con entidades, normalización como el front y errores con los textos del contrato.
  - 14 casos de uso más `GetAdminSessionQuery`, sin Nest y cableados con `useFactory`.
  - Adaptadores: 4 repositorios Prisma, argon2id, `LogMailer` y el bloqueo por email en Redis.
  - Tres controladores con las **18 operaciones** de `/auth/*`, `/me*` y `/admin/auth/*`.
  - DTOs que validan con los mensajes del front.
  - `@Throttle` 20/min en las escrituras de autenticación.
- **Contrato** (fix de la Task 5): `validation-cases.contract.spec.ts` corre los casos compartidos
  de `../frontend/docs/api/validation-cases.json` contra los DTOs (120 casos).
- **Logs** (Task 6, `6b34120`): pino tapa también `Referer` y `X-CSRF-Token`. La prueba en vivo
  mostró que el token de recuperación llegaba al log en el `Referer` (detalle en "Verificación").
- **Docs** (Task 6): este apartado, la sección "Cuenta y admin" del README, el ADR 0003 y el
  comentario de `STORE_ORIGIN` en `.env.example`.

### Decisiones

Rulings de la planificación (ledger del flujo, B-3 a B-8):

- **B-3 · Alcance:**
  - Las operaciones de identidad del contrato: `/auth/csrf`, `register`, `login`, `logout`,
    `password/forgot` y `password/reset`; `/me` (`GET` y `PATCH`); `GET /me/orders` (página vacía
    hasta B4); `/me/addresses` (`GET`, `POST`, `PATCH` y `DELETE`); y `/admin/auth/login`,
    `logout`, `me`, `csrf` y `password`.
  - El ruling decía "16", pero su propia lista suma **18**, y son las 18 que quedaron.
  - Sin verificación de email, porque no está en el contrato.
  - `GET /me/orders/{number}` espera a B4.
  - `document_type` y `document_number` existen como columnas, pero ninguna ruta las completa.
- **B-4 · Sesiones:**
  - En Redis: `session:{id}` con un JSON, y el set `user-sessions:{userId}`.
  - Ids y tokens de 32 bytes aleatorios en hex.
  - Duración fija: anónima 24 h, cliente 30 días, admin 8 h.
  - Varias sesiones por usuario. El `reset` las cierra todas.
  - Sin Redis, 503 (falla cerrada). La caché y el throttler siguen fallando abiertos.
- **B-5 · Cookies y CSRF:**
  - Nombres exactos del contrato, siempre con `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age`.
  - Un token CSRF por sesión, que rota con la sesión al registrarse o iniciar sesión.
  - 403 `csrf_invalid` para el cliente y para el admin (el mock respondía `forbidden` al cliente).
  - `GET /auth/csrf` sin sesión abre una anónima.
- **B-6 · Contraseñas y recuperación:**
  - argon2id con 19 MiB, t=2 y p=1.
  - Token `rt_` + 64 hex: se guarda solo su SHA-256, vence a los 60 minutos y se usa una sola vez.
  - Link `${STORE_ORIGIN}/cuenta/restablecer?token=…`.
  - El mail va detrás de `MailerPort`, con un adaptador de log hasta B7.
  - `forgot` responde siempre 202.
- **B-7 · Abuso:**
  - `@Throttle` 20/min por IP en el registro, los dos logins, `forgot` y `reset`.
  - Bloqueo por email tras 10 fallos en 15 minutos: 429 con `Retry-After`. Falla abierto sin
    Redis.
  - Admin semilla con las credenciales del demo del front, y un nuevo seed nunca lo pisa.
- **B-8 · Olas:**
  - W1: Task 1 en paralelo con la Task 2.
  - W2: Task 3. W3: Task 4. W4: Task 5. W5: Task 6.

Decisiones tomadas en el camino:

- **`LoginAttemptsPort.blockedFor`** (Task 3): sin esto, un email bloqueado seguía aceptando la
  contraseña correcta.
- **Registro atómico** (fix de la Task 3):
  - `CustomerRepository.createWithUser` y `attachUser` crean el usuario y el cliente en una sola
    transacción.
  - Antes, un fallo en el medio dejaba un usuario sin cliente, que no podía ni registrarse ni
    entrar.
- **Libreta como el mock:**
  - La primera dirección no queda predeterminada a la fuerza.
  - Borrar la predeterminada no promueve otra.
  - `PATCH` reemplaza la dirección entera.
  - Un id que no es UUID v7 da 404, sin consultar la base.
- **Robustez de la libreta:** dos altas predeterminadas a la vez se resuelven con `updateMany`
  previo y un reintento ante `P2002`. Un borrado doble usa `deleteMany`, sin 500.
- **`GetAdminSessionQuery`** (Task 5): la sesión solo guarda el `userId`, así que hacía falta para
  devolver el email en `GET /admin/auth/me`.
- **DTOs:**
  - Validan sobre el valor crudo del JSON: `"false"` no pasa a `true` (deuda de B2 cerrada).
  - Validan en el orden de zod, así que el primer error es el mismo que el del front.
  - `label` y `apartment` aceptan además que falten, como el mock.
  - Contraseña actual mal: `invalid_password`. Confirmación distinta: `custom`.
- **`security` y `requestBody` en el contrato** (Task 2): cierra la deuda de B2. Las cabeceras
  todavía no se comparan.
- **Logs sin secretos** (Task 6): `Referer` y `X-CSRF-Token` se suman a `Cookie`, `Set-Cookie` y
  `Authorization`.

### Versiones reales instaladas

| Paquete                                             | Versión                 |
| --------------------------------------------------- | ----------------------- |
| `argon2` / `cookie-parser` / `@types/cookie-parser` | 0.45.1 / 1.4.7 / 1.4.10 |

Son las del plan. Están en la tabla de B1/B2 y en `scripts/dependency-versions.json`.

- `argon2`: es la mayor 0.45.x y trae binarios precompilados.
- `@types/cookie-parser`: es la última 1.4.x.

Para las pruebas en vivo se usó lo que ya tenía instalado el front: Next.js 16.4.2, Vite 8.3.4 y
Playwright 1.64.1 (Chromium headless 156). Docker Engine 28.4.0.

### Verificación

- **Suite completa en verde:**
  - `npm run typecheck`, `npm run lint` (versiones y fronteras) y `npm run format:check`.
  - `npm test`: 36 archivos, 276 tests.
  - `npm run test:e2e`: 13 archivos, 233 tests y 1 omitido. Testcontainers con
    `postgres:17-alpine` y `redis:8-alpine`.
  - `npm run contract:check`: 3 archivos, 140 tests y 1 omitido. **31 operaciones implementadas y
    46 pendientes de 77**, sin diferencias.
- **Review Focus del plan, cubierto con tests:**
  1. Cookie exacta y borrado con `Max-Age=0`.
  2. Email con mayúsculas o espacios, y 409 con `citext`.
  3. Rotación: el token anónimo da 403 después del login.
  4. Token de recuperación de un solo uso, que vence y cierra las sesiones.
  5. Una sola predeterminada bajo concurrencia: 8 libretas con dos altas en paralelo cada una,
     con chequeo de mutación.
- **Prueba en vivo de la tienda (Task 6, paso 1):**
  - Back compilado en el 3001 (`ADMIN_ORIGIN=http://localhost:5273`,
    `STORE_ORIGIN=http://localhost:4300`), con Postgres y Redis de compose, migrado y sembrado.
  - Tienda compilada en modo `live` y servida con `next start` en el 4300, con el entorno en la
    misma línea (sin `.env.local`).
  - Playwright headless (Chromium), todo en verde en la primera corrida. Capturas en
    `.superpowers/sdd/2026-11-02-b3-identidad/captures/`:
    - `/cuenta/registro` (Nombre, Apellido, Email, Contraseña) → `/cuenta` con "Hola, Ana", y la
      cookie `__Host-galpon_session` `Secure` y `HttpOnly` (`store-1-registro-cuenta.png`).
    - `/cuenta/direcciones`: "Casa, Av. Rivadavia 4321, CP 1406, Buenos Aires, CABA" como
      predeterminada → se ve "Predeterminada" (`store-2-direccion-predeterminada.png`).
    - "Cerrar sesión" → `/`, sin cookie (`store-3-logout-inicio.png`).
    - `/cuenta/ingresar` → `/cuenta` con la dirección guardada (`store-4-login-cuenta.png`).
    - `/cuenta/recuperar` → "Revisá tu correo", y el link
      `http://localhost:4300/cuenta/restablecer?token=rt_…` aparece en el log del back
      (`store-5-recuperar-revisa-tu-correo.png`).
    - Además: ese link abre `/cuenta/restablecer`, la contraseña nueva se guarda ("Listo, cambiaste
      tu contraseña", `store-6-restablecer-listo.png`), la vieja da "Email o contraseña
      incorrectos." y la nueva entra.
    - Sondeo de lo pendiente: `/cuenta/pedidos` muestra "Todavía no hiciste pedidos"
      (`store-7-pedidos-vacio.png`). El checkout precarga el email y el nombre de la sesión, pero
      `POST /cart/quote` da 404 (B4) y muestra "No pudimos actualizar el resumen"
      (`store-8-checkout-en-vivo.png`).
- **Hallazgo de la prueba en vivo:**
  - Desde `/cuenta/restablecer?token=…`, cada pedido de la página llegaba al back con esa URL como
    `Referer`, y pino la registraba, con el token. Lo mismo pasaba con `X-CSRF-Token`.
  - Se arregló en `6b34120`: las dos cabeceras van como `[Redacted]`, con un test que corre pino.
  - Repetida la prueba con el back nuevo, la única línea con `rt_` es la del `LogMailer` (que en
    producción no lleva el link). Ningún `X-CSRF-Token` en claro, y 34 `Referer` tapados.
- **Prueba en vivo del admin (Task 6, paso 2):**
  - Admin compilado con `VITE_API_MODE=live VITE_API_BASE_URL=http://localhost:3001` y servido con
    `vite preview --port 5273 --strictPort`.
  - **Aviso:** `VITE_API_BASE_URL` también tiene que estar al correr `vite preview`. La CSP del
    preview arma `connect-src` al arrancar, y sin la variable el navegador bloqueaba
    `/admin/auth/*`: el login mostraba "No pudimos conectar, probá de nuevo". Con la variable,
    todo en verde:
    - `/login` con el admin semilla → "Resumen", con la cookie `__Host-galpon_admin`
      `Secure`/`HttpOnly`/`Lax` (`admin-1-login-resumen.png`).
    - Recargar mantiene la sesión (`admin-2-recarga-sigue-en-resumen.png`).
    - "Cerrar sesión" → `/login`, sin cookie (`admin-4-logout-login.png`).
    - Contraseña mala → "Email o contraseña incorrectos" (`admin-5-clave-mala.png`).
- **Pantallas del admin que fallan en vivo hasta B6:**
  - Resumen, Pedidos, Productos, Líneas, Contenido, Reseñas, Mensajes y Ajustes muestran "No
    pudimos cargar…". Sus rutas `/admin/*` dan 404: `dashboard/summary`, `orders`, `products`,
    `categories`, `content/*`, `reviews`, `messages` y `settings`
    (`admin-3-productos-en-vivo.png`).
  - "Productos → nuevo" y "Mi cuenta" cargan.
  - El contador de la barra lateral pide `dashboard/summary` en todas las pantallas (404).
- **Docker:** Docker Desktop se cerró solo al terminar las pruebas en vivo (la tercera vez en el
  día). Se repitió el arreglo de B1/B2: renombrar `%LOCALAPPDATA%\Docker\run` y abrir Docker
  Desktop. Al cierre no quedan procesos en el 3001, el 4300 ni el 5273, ni contenedores de compose.

### Commits

| Commit    | Qué                                                                                          |
| --------- | -------------------------------------------------------------------------------------------- |
| `7640a3b` | Plan de B3                                                                                   |
| `23cacd0` | Sesiones en Redis, cookies `__Host-`, guards y CSRF; el contrato compara `security` (Task 2) |
| `b8eabee` | Usuarios, clientes, direcciones y tokens de recuperación; admin semilla (Task 1)             |
| `3def241` | Dominio y casos de uso de identidad (Task 3)                                                 |
| `b057864` | Registro atómico de usuario y cliente (fix Task 3)                                           |
| `1f29807` | Adaptadores Prisma, argon2, mailer de log y bloqueo de intentos (Task 4)                     |
| `22a906c` | Rutas de cuenta, sesión y admin, con E2E de autenticación (Task 5)                           |
| `c65c359` | Casos compartidos de validación del front contra los DTOs (fix Task 5)                       |
| `6b34120` | Logs sin `Referer` ni `X-CSRF-Token` (Task 6)                                                |
| Task 6    | Esta bitácora, el ADR 0003, el README de cuenta y admin y `.env.example`                     |

### Lo que queda para B4 en adelante

**Para B4 (pedidos y stock):**

- `GET /me/orders` con datos reales, y `GET /me/orders/{number}`.
- Mover `OrderStatus`, `PaymentStatus`, `OrderNumber`, `TotalArs` y `OrderSummary*` de
  `identity/interface/dto` al módulo `orders` (reutilizar `ORDER_STATUSES`).
- `AddressInput` va a `src/shared/infrastructure/http`, para no importar la capa `interface` de
  identidad.
- Revisar la adopción de un invitado al registrarse con su email: hoy la cuenta se queda con sus
  pedidos y su teléfono sin verificar el email (ADR 0003).
- `PrismaCustomerRepository.create` no traduce `P2002`: B4 decide qué hacer con un invitado
  repetido.

**Para B7 (comunidad, soporte y emails):**

- El proveedor de mail real detrás de `MailerPort`. Tiene que encolar o tragar sus errores, para
  que `forgot` siga dando siempre 202 y tarde lo mismo exista o no la cuenta.

**Para B8 (producción):**

- `trust proxy` para el límite por IP.
- `NODE_ENV=production` obligatorio: si falta, el `LogMailer` registra los links.
- El admin semilla no puede quedar con la contraseña pública: que `seedAdmin` se niegue en
  producción o tome la contraseña de una variable.
- `exposedHeaders: ['Retry-After']` en CORS, si el admin llega a mostrar la espera del 429.

**Menores anotados en las revisiones:**

- **Sesiones en Redis:**
  - `destroyAllForUser` tiene una ventana entre `SMEMBERS` y `DEL`.
  - El set `user-sessions:*` no se poda. Un script Lua resuelve las dos cosas.
- **Recuperación y bloqueo:**
  - Si Redis cae justo después de cambiar la contraseña, el `reset` deja vivas las sesiones viejas
    y el token ya usado.
  - El `reset` no limpia el bloqueo por email.
  - La contraseña actual mal del admin no cuenta para el bloqueo.
- **Libreta:**
  - `replace` lanza P2025 (500) si la dirección se borra en el medio.
  - El reintento de la predeterminada es uno solo: con 3 o más altas simultáneas puede dar 500.
- **Código:**
  - `prisma/seed.ts` duplica los parámetros de argon2 (debería importar `ARGON2_OPTIONS`).
  - `sessionCookie` acepta un id vacío.
  - `admin-auth.controller.ts` importa `CsrfTokenView` de otro controlador.
- **Tests:**
  - Falta un test que pegue contra el `@Throttle` de 20/min.
  - El test "el módulo exporta GetMeQuery" no prueba la exportación.
  - El E2E de auth ya hace 16 logins desde una IP: hay que cuidar el límite si se suman casos.
