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
  - Playwright headless (Chromium), todo en verde en la primera corrida. Capturas locales en
    `.superpowers/sdd/2026-11-02-b3-identidad/captures/` (git ignora esa carpeta: un clon no las
    tiene):
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
| `36e3982` | Esta bitácora, el ADR 0003, el README de cuenta y admin y `.env.example` (Task 6)            |
| Cierre    | CORS expone `Retry-After`, `CsrfTokenView` compartido, eslint ignora `.superpowers/`, docs   |

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

**Para B6 (admin):**

- Las rutas `/admin/*` que el panel ya pide y hoy dan 404: `dashboard/summary` (también el
  contador de la barra lateral), `orders`, `products`, `categories`, `content/*`, `reviews`,
  `messages` y `settings`. Hasta entonces, 8 pantallas muestran "No pudimos cargar…".

**Para B7 (comunidad, soporte y emails):**

- El proveedor de mail real detrás de `MailerPort`. Tiene que encolar o tragar sus errores, para
  que `forgot` siga dando siempre 202 y tarde lo mismo exista o no la cuenta.

**Para B8 (producción):**

- `trust proxy` para el límite por IP.
- `NODE_ENV=production` obligatorio: si falta, el `LogMailer` registra los links.
- El admin semilla no puede quedar con la contraseña pública: que `seedAdmin` se niegue en
  producción o tome la contraseña de una variable.

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
  - `PATCH /me/addresses/{id}` con cuerpo inválido e id inexistente da 422 antes que 404 (el mock
    del front daba 404 primero; el contrato lo permite).
  - El reintento de la predeterminada es uno solo: con 3 o más altas simultáneas puede dar 500.
- **Código:**
  - `prisma/seed.ts` duplica los parámetros de argon2 (debería importar `ARGON2_OPTIONS`).
  - `sessionCookie` acepta un id vacío.
- **Tests:**
  - Falta un test que pegue contra el `@Throttle` de 20/min.
  - El test "el módulo exporta GetMeQuery" no prueba la exportación.
  - El E2E de auth ya hace 16 logins desde una IP: hay que cuidar el límite si se suman casos.
  - Los caminos de `StaleSessionError` (sesión de cliente sin cliente, admin deshabilitado o
    inexistente) no tienen test.

## B4 · Pedidos y stock (2026-11-03)

Plan: [`docs/superpowers/plans/2026-11-02-b4-pedidos.md`](superpowers/plans/2026-11-02-b4-pedidos.md)
(6 tareas en 5 olas). Decisiones de arquitectura en
[ADR 0004 · reservas de stock y vencimiento](adr/0004-reservas-de-stock-y-vencimiento.md).

### Qué quedó

- **Esquema** (Task 1):
  - Tablas `orders`, `order_items`, `order_item_components`, `order_status_history`, `shipments`
    y `stock_reservations`, con 6 enums (`order_status`, `payment_status`, `payment_method`,
    `line_type`, `order_actor` y `reservation_status`).
  - Escritos a mano en la migración `20261102234632_b4_pedidos`: la secuencia `order_number_seq`
    (10001 a 99999, sin ciclo) y los CHECK `order_items_quantity_check` (1 a 20),
    `stock_reservations_quantity_check` y `orders_totals_check` (subtotal = bruto − ahorro,
    total = subtotal + envío).
  - `reviews.order_item_id` gana su FK a `order_items` (`SET NULL`).
  - El seed nunca baja `on_hand` por debajo de `reserved`: deja la fila y avisa.
- **Cimientos compartidos** (Task 2, `src/shared`):
  - `DomainError` y `ProblemFilter` llevan `changes` (solo en los 409) y `errors` (solo en los
    422), con `ChangeNotice` y `FieldError` en `src/shared/domain/change-notice.ts`.
  - `OptionalCustomerSessionGuard` y `@OptionalSession()`: sin cookie no toca Redis; con cookie y
    Redis caído, 503.
  - Mudanzas: `customerIdOf`/`adminUserIdOf` a `auth/session-ids.ts` y `AddressInputDto` a
    `http/address-input.dto.ts` (identidad re-exporta). `IdentityModule` exporta
    `CUSTOMER_REPOSITORY`.
  - pino tapa `X-Order-Token`. `GET /products?ids=` ya no pasa por la caché, y las claves
    `catalog:products:slug:*` y `catalog:products:group:*` se exportan para borrarlas al reservar.
  - Soporte de tests: `test/support/http.ts` (`Jar`, `call`, `refreshCsrf`) y
    `createApp({ clock })`.
- **Dominio y casos de uso** (Task 3, `src/modules/orders/{domain,application}`):
  - `priceCart`, puro, sigue el mock del front paso a paso: claves de línea, kits, tope de 20 por
    producto entre todas las líneas, disponibilidad compartida, precedencia de los problemas de
    línea, neto sin IVA y tope del total.
  - `CreateOrderCommand`, `ExpireOrdersCommand`, `QuoteCartQuery`, `QuoteShippingQuery`,
    `GetOrderQuery`, `ListMyOrdersQuery` y `GetMyOrderQuery`, sin Nest y cableados con
    `useFactory`. Cinco puertos: catálogo, ajustes, repositorio, clientes y programador del
    vencimiento.
- **Adaptadores y módulo** (Task 4):
  - `PrismaOrderRepository`: reserva atómica con `UPDATE` condicional por producto ordenado,
    todos los faltantes juntos, número después del stock, y pedido completo y outbox en una sola
    transacción. `expire` es condicional e idempotente.
  - `CatalogProductsAdapter` (lee `products` + `inventory` sin caché), `SettingsStoreAdapter` e
    `IdentityCustomersAdapter` (si dos crean el mismo invitado, devuelve el que ganó).
  - Cola `order-expiration`: `BullOrderExpirationScheduler`, `OrderExpirationProcessor` y el
    barrido `OrderExpirationSweep` cada 60 s.
- **Rutas** (Task 5):
  - `CartController` (`POST /cart/quote` y `POST /shipping/quote`), `OrdersController`
    (`POST /orders` y `GET /orders/{number}`) y `MyOrdersController` (`GET /me/orders` y
    `GET /me/orders/{number}`), con los DTOs del contrato. `GET /me/orders` deja `MeController`.
  - El contrato pasa a **36 operaciones implementadas de 77**, y los casos compartidos de
    validación suman el contacto y el envío del checkout.
- **Docs** (Task 6): este apartado, la sección "Pedidos y stock" del README y el ADR 0004.
  `.env.example` no cambia: B4 no suma variables (los 30 minutos son una constante del contrato).

### Decisiones

Rulings de la planificación (ledger del flujo, B-14 a B-31):

- **B-14 · El mock manda donde el contrato solo da un ejemplo:**
  - Claves `product:{id}:{cuero|-}:{virola|-}` y `kit:{m}:{b}:{y}:{cuero}`.
  - `detail` `Cuero negro · Alpaca cincelada` y `{mate} + {bombilla} + {yerba} · Cuero negro`.
  - Kit con nombre `Kit` y opciones `{ leather, ferrule: 'Alpaca cincelada' }`.
  - Tope de 20 por producto en el orden del carrito; opciones ignoradas fuera de los mates; mate
    sin opciones → 422 `items.{i}.options`.
  - Piezas no disponibles → `unavailable`; `quantity_reduced` antes que `price_changed`; líneas
    bloqueadas en cero.
- **B-15 · Dinero:** ahorro del kit por unidad (`percentOf` sobre la suma de las tres piezas) por
  cantidad; neto sin IVA redondeado por unidad y en el subtotal; más de `2_147_483_647` → 422.
- **B-16 · Número:** `GLP-` + secuencia desde 10001. Los `GLP-09001…09012` quedan para la demo del
  admin (B6).
- **B-17 · Token:** `ot_` + 64 hex, solo su SHA-256 en la base, sin vencimiento propio, también en
  el replay.
- **B-18 · Reserva:**
  - 30 minutos, como constante. `reserved_until` no cambia nunca.
  - Estado inicial `pending_payment` / `none`, con `history[0]` del cliente.
  - El vencimiento suma `expired` en `reserved_until` (actor `system`).
- **B-19 · Copias al comprar:** contacto, dirección (jsonb), plazo y costo del envío, medio de
  pago, descuento del kit, y nombres, slugs y precios de líneas y piezas.
- **B-20 · Dueño:** gana la sesión. Sin sesión, invitado por email (nuevo o actualizado); si el
  email es de una cuenta, el pedido queda sin dueño (solo token). La adopción al registrarse (B3)
  sigue.
- **B-21 · Seguridad de las rutas:**
  - `/cart/quote`, `/shipping/quote` y `POST /orders` sin CSRF; sesión opcional en `POST /orders`.
  - `GET /orders/{number}` por token o sesión, siempre con el mismo 404.
  - `/me/orders*` con sesión y 10 por página.
- **B-22 · Idempotencia:** `@Idempotent('orders')` sin cambios; solo se guarda el 201.
- **B-23 · Honeypot:** `website` con texto → 201 con `GLP-00000`, sin guardar ni reservar.
- **B-24 · Stock:** contador + filas, `UPDATE` condicional, `ChangeNotice` por producto,
  precedencia stock > precio > total, títulos y `detail` fijos, caché borrada al reservar o
  liberar.
- **B-25 · Vencimiento:** job, barrido y lectura, idempotentes. `pending` y `action_required` no
  vencen.
- **B-26 · Envío:** costo y plazo de `shipping_options`; método deshabilitado → 422 con el
  `detail` que muestra la tienda; `/shipping/quote` pide el código postal salvo en el retiro.
- **B-27 · Límites:** `@SkipThrottle()` en todo menos `POST /orders` (120 por minuto por IP).
- **B-28 · Eventos:** `order.created` y `order.expired` en el outbox, en la misma transacción.
- **B-29 · Mudanzas:** DTOs de pedidos de identidad a `orders`, `GET /me/orders` a
  `MyOrdersController`, `AddressInputDto` y `session-ids` a `shared`.
- **B-30 · Seed:** sin pedidos sembrados; nunca baja `on_hand` por debajo de lo reservado; FK de
  `reviews.order_item_id`.
- **B-31 · Olas:**
  - W1: Tasks 1 y 2 en paralelo.
  - W2: Task 3. W3: Task 4. W4: Task 5. W5: Task 6.

Decisiones tomadas en el camino:

- **El número se pide después del stock** (Task 4, sugerido en la revisión de las Tasks 1 y 2): un
  409 por carrera no gasta números de la secuencia, que no vuelve atrás.
- **Eventos como función** (Task 3): `aggregateId` es el número, que asigna el repositorio dentro
  de la transacción. El caso de uso pasa `(order) => eventos` y el repositorio la llama con el
  pedido ya guardado.
- **`expire` exige también `reserved_until <= now`** (Task 3): un job que corre antes de hora no
  vence nada. El repositorio compara con el reloj de la app, no con el de Postgres.
- **Sin `include` dentro de las transacciones** (Task 4): con el adapter de `pg`, Prisma manda
  esas consultas en paralelo por la misma conexión y `pg` avisa `DeprecationWarning`. `expire` lee
  el pedido antes de abrir la transacción.
- **`maxWait: 5_000`** en la transacción de crear (Task 4): con muchos pedidos a la vez, el pool de
  10 conexiones se llenaba y los 2 s por defecto daban 500.
- **El processor cierra su worker** (Task 4): con Redis caído, el `close()` normal de BullMQ no
  termina nunca y colgaba el cierre de la app. Si la cola no contesta en 1 s, cierra forzado (el
  job en curso se reintenta, y vencer es idempotente).
- **Discriminador de líneas con `@Transform`** (Task 5): class-transformer 0.5.1 respondía 500 con
  `items: [null]`. Un `type` desconocido da un solo 422 `items.N.type`.
- **`X-Order-Token` con un decorador propio** (Task 5): con `@Headers()`, Swagger lo publicaba como
  parámetro, y el contrato lo declara como esquema de seguridad.
- **El teléfono se normaliza en el DTO,** como `optionalPhoneSchema` del front (`+54 9 11 …` →
  `1123456789`): lo piden los casos compartidos del checkout.
- **Doble envío simultáneo** (Task 5; corrige el Review Focus 1 del plan):
  - Con la misma clave, el segundo pedido que llega mientras corre el primero recibe
    `409 idempotency_in_progress` (interceptor de B1, sin cambios por B-22).
  - Se crea un solo pedido, todo 201 trae el mismo número y el mismo token, y el reintento recibe
    el 201 guardado con `Idempotent-Replayed: true`.
  - "Los dos reciben 201" exigiría que el interceptor espere al primero (B8).
- **E2E de vencimiento moviendo las fechas del pedido** (Task 5), en lugar de adelantar el reloj de
  toda la app, que habría vencido los pedidos de los otros casos.

### Versiones reales instaladas

B4 no instaló nada: usa `@nestjs/bullmq` 12.0.0 y `bullmq` 6.5.3, que ya estaban desde B1.
`package.json`, `package-lock.json` y `scripts/dependency-versions.json` no cambiaron.

Para la prueba en vivo se usó lo que ya tenía instalado el front: Next.js 16.4.2 y Playwright
1.64.1 (Chromium headless). Docker Engine 28.4.0.

### Verificación

- **Suite completa en verde:**
  - `npm run typecheck`, `npm run lint` (versiones y fronteras) y `npm run format:check`.
  - `npm test`: 50 archivos, 410 tests.
  - `npm run test:e2e`: 15 archivos, 330 tests y 1 omitido (234 s). Testcontainers con
    `postgres:17-alpine` y `redis:8-alpine`.
  - `npm run contract:check`: 3 archivos, 205 tests y 1 omitido. **36 operaciones implementadas y
    41 pendientes de 77**, sin diferencias.
- **Review Focus del plan, cubierto con tests:**
  1. Doble envío: un solo pedido, mismo número y token, replay con `Idempotent-Replayed`; la misma
     clave con otro cuerpo → 422 `idempotency_key_reused`; una clave nueva tras un 409 → 201.
  2. Sin sobreventa: 10 pedidos simultáneos sobre 5 unidades → 5 pedidos, `reserved = 5`, 5
     reservas activas y 5 `409` con "X se agotó." (dominio, repositorio y HTTP). El mismo
     producto suelto y en un kit comparte el stock.
  3. Vencimiento: `GET /orders/{number}` responde `expired` aunque la cola no haya corrido, con
     `history[1].at = reservedUntil`. El stock vuelve, y job, barrido y lectura liberan una sola
     vez.
  4. Dueño correcto: con sesión, en `GET /me/orders`; invitado con el email de una cuenta, solo
     por token (404 por sesión); invitado que después se registra, en su cuenta.
  5. Cuentas del kit (`75997` / `15200` / `136794` / `56526`), claves con `Alpaca cincelada`, y mate
     suelto + kit sin stock para la segunda línea.
- **Prueba en vivo de la tienda (Task 6):**
  - Back compilado (`node dist/main`) en el 3001 con `STORE_ORIGIN=http://localhost:4300`, sobre
    el Postgres y el Redis de compose, migrado (`20261102234632_b4_pedidos`) y sembrado.
  - Tienda compilada en modo `live` (`npm run build -w @galpon/store` y
    `next start --port 4300`), con el entorno en la misma línea (sin `.env.local`).
  - Script de Playwright `live-store.mjs` en el workspace: 11 de 11 pasos en verde. Capturas
    locales en `.superpowers/sdd/2026-11-02-b4-pedidos/captures/` (git ignora esa carpeta: un clon
    no las tiene):
    - Carrito con el Mate Imperial Premium y un kit (Imperial Premium + Bombillón 100% Alpaca +
      Yerba Canarias Serena): `$39.999` y `$70.648`, "Ahorrás $7.850" (10 % de `$78.498`) y
      subtotal `$110.647` (`b4-1-carrito-mate-y-kit.png`).
    - Checkout de invitado: contacto, "Retiro en persona" y paso 3
      (`b4-2-checkout-paso-pago.png`).
    - "Mercado Pago" → `POST /orders` 201 (`GLP-10003` en la corrida final) y "Reservamos tu pedido
      por 30 minutos (hasta el 03/11/2026 01:28).". El mate queda con `maxQuantity` 10: 12 − 2, el
      suelto y el del kit (`b4-3-reserva-30-minutos.png`).
    - "Pagar $110.647 con Mercado Pago" → 404 en `…/payments/mercadopago/preference` (B5) y "No
      pudimos iniciar el pago. Probá de nuevo." (`b4-4-pago-falla-b5.png`).
    - `/checkout/resultado?pedido=…` → "No completaste el pago" (`b4-5-resultado-sin-pagar.png`).
    - `reserved_until` al pasado por SQL y recarga → "El pedido venció"
      (`b4-6-pedido-vencido.png`). En la base: pedido `expired`/`none`, las tres reservas
      `released`, historial `pending_payment` (cliente) y `expired` (sistema), outbox
      `order.created` y `order.expired`, y el mate de nuevo con `maxQuantity` 12 (`inventory`
      12/0).
    - Cuenta: registro, contacto precargado con el email de la sesión, envío a domicilio y
      "Mercado Pago" → 201 con el `customer_id` de la cuenta. `/cuenta/pedidos` lo lista con
      "Esperando el pago" (`b4-7-cuenta-pedidos-esperando-pago.png`). El detalle muestra "Sin
      pagar", "Envío a domicilio", la dirección, el plazo, los totales con el envío de `$6.500` y
      el historial (`b4-8-cuenta-detalle-historial-envio.png`).
    - Precio subido por SQL entre la cotización y la confirmación (Camionero Virola de Aluminio,
      `$24.999` → `$26.999`): `409 price_changed` "Cambiaron los precios" con un solo `change`, y
      el alert "Algo cambió en tu carrito" con un ítem: "Camionero Virola de Aluminio cambió de
      precio: ahora cuesta $26.999." (`b4-9-precio-cambiado-alert.png`). "Confirmar de nuevo" →
      201 con total `26999` y el botón "Pagar $26.999 con Mercado Pago"
      (`b4-10-confirmar-de-nuevo-201.png`). Al final el precio volvió a `$24.999`.
  - **Barrido en vivo:** con el back andando, dos pedidos pendientes con `reserved_until` movido al
    pasado quedaron `expired` a los 42 s, sin ninguna lectura: reservas `released`, un
    `order.expired` cada uno e `inventory.reserved` en 0 en todo el catálogo.
  - **Logs:** ningún `warn` ni `error` en toda la prueba. Las 9 apariciones de `x-order-token`
    salen como `[Redacted]`, y no hay ningún `ot_…` en claro.
  - Las dos primeras corridas del script se cortaron por un SQL ambiguo del propio script, cuando
    la tienda ya mostraba "El pedido venció". Por eso la corrida final arranca en `GLP-10003`. No
    hubo nada que corregir en el back ni en la tienda.
  - Al cierre no quedan procesos en el 3001, el 4300 ni el 5273, ni contenedores de compose, y el
    front no tiene cambios.

### Commits

| Commit    | Qué                                                                                        |
| --------- | ------------------------------------------------------------------------------------------ |
| `3f00c5a` | Plan de B4                                                                                 |
| `ec4853f` | Pedidos, ítems, historial, envíos y reservas; secuencia `GLP-` (Task 1)                    |
| `b464242` | `changes` y `errors` en los problemas, sesión opcional, listas por ids sin caché (Task 2)  |
| `06150fb` | Dominio de cotización y pedidos; casos de uso de creación, lectura y vencimiento (Task 3)  |
| `60eaeab` | Repositorio Prisma con reserva atómica, cola de vencimiento, adaptadores y módulo (Task 4) |
| `e971083` | Rutas de cotización, pedidos y mis pedidos, con E2E de doble envío y concurrencia (Task 5) |
| Task 6    | Esta bitácora, el ADR 0004 y el README de pedidos                                          |

### Lo que queda para B5 en adelante

**Para B5 (pagos):**

- Las rutas de pago que la tienda ya llama y hoy dan 404: preferencia de Mercado Pago, tarjeta,
  cuotas y `cancel-payment`, todas con `X-Order-Token`.
- Al aprobar un pago, pasar las reservas a `committed` (y descontar `on_hand` y `reserved`).
- Consumir `order.expired` para cancelar la preferencia de Mercado Pago.
- Decidir cuándo vence un pedido con el pago `pending` o `action_required` (hoy no vence nunca).

**Para B6 (admin):**

- Pedidos del admin y la demo `GLP-09001…09012`.
- Si el admin edita `on_hand`, no puede bajarlo por debajo de `reserved` (el CHECK lo rechaza):
  hace falta un mensaje claro, y `version` sirve para detectar ediciones simultáneas.

**Para B7 (comunidad, soporte y emails):**

- `verified_purchase` de las reseñas a partir de `order_items`.
- Si se agrega verificación de email, la adopción de pedidos de invitado al registrarse (B-20,
  ADR 0004) debería esperarla.

**Para B8 (producción):**

- `trust proxy` y un límite por sesión: hoy toda la tienda comparte el límite de 120 por minuto de
  `POST /orders`, por la IP del servidor de Next.
- Que el interceptor de idempotencia espere al pedido en curso en lugar de responder 409. La
  tienda trata cualquier 409 como "Algo cambió en tu carrito" y descarta la clave.
- Purgar las `idempotency_keys` vencidas: el 201 guardado tiene el `orderToken` en claro.

**Menores anotados en las revisiones:**

- **Código:**
  - `address-input.dto.ts` repite mensajes, patrones y `Trimmed` de `identity-fields.ts`, y
    `shared` importa `identity/domain/province`. Mover los campos a
    `src/shared/infrastructure/http/fields.ts` y `PROVINCES` a `src/shared/domain`.
  - `identity-customers.adapter.ts` importa `isUniqueViolation` del mapper de identidad: llevarlo
    a `src/shared/infrastructure/prisma/`.
  - `expireDue` deja de vencer y lanza si falla un `expire`: un error de limpieza le daría 500 a
    cotizar, crear o listar. Aislar el error por pedido.
  - `expireDue` trae los pedidos con `findDue` y `expire` los vuelve a leer (N+1 de hasta 50).
  - `OrderExpirationProcessor.onFailed` dice "pedido undefined" si no hay job, y comparte el
    limitador de avisos con `onError`.
  - `optionalSessionFromContext` devuelve cualquier sesión ya cargada (hoy ninguna ruta combina
    guards).
  - `prisma/seed.ts`: una línea de 130 caracteres en el TSDoc de `seed()`.
  - Si `create` falla por stock, el invitado creado en ese intento queda guardado (es inofensivo:
    el próximo pedido lo vincula).
  - Cosméticos: `ownerOf` sin tipo de retorno explícito; los constructores de
    `OrderNotFoundError` y `CartTotalTooBigError` sin TSDoc propio.
- **Tests:**
  - Ningún test del tope de 20 sumando líneas (todos los productos de prueba tienen 12 o menos).
  - Faltan el total demasiado grande por culpa del envío y un `price_changed` de un kit.
  - El E2E de `expire` solo mira la clave `slug` de la caché, y ningún caso vence un pedido con el
    pago `rejected` o `cancelled`.
  - El spec del processor depende del campo privado `_worker` de `WorkerHost`.
  - Nada prueba que `POST /orders` siga bajo el límite global, ni el 503 de
    `GET /orders/{number}` con cookie y Redis caído.
  - Ningún `POST /orders` con kit por HTTP, ni `POST /shipping/quote` con un método deshabilitado
    (los cubren las Tasks 3 y 4 por debajo del HTTP).
  - `prisma.e2e-spec.ts`: el tercer test nuevo usa el producto que crea el segundo (falla con
    `-t`).
