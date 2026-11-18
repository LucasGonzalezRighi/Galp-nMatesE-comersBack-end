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
  6 líneas, 27 productos, 15 reseñas, 7 contenidos, ajustes y 3 envíos (desde el 2026-11-03, 18
  reseñas con 10 destacadas: el front sumó las del collage sobre el mate).
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
| `mercadopago` (B5, Task 1; sin dependencias, CommonJS con tipos propios)              | 3.6.1                                                             |
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
  pago, descuento del kit, y nombres, slugs y precios de líneas y piezas. Las columnas
  `payment_method`, `shipping_eta`, `product_slug` y el `slug` de las piezas no estaban en la
  spec §4.3: son un agregado de B4, y la tabla de la spec quedó actualizada.
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
- **`OrdersModule` no importa `CatalogModule`** (Task 4): lee `products` e `inventory` con Prisma
  directo (solo lectura, ADR 0001) y no inyecta nada del catálogo.
- **Textos que el mock dejaba a zod, fijados en español** (Task 5): un `type` de línea desconocido
  o un método de envío inexistente responden con mensajes propios, no con los de la librería.
- **Doble envío simultáneo** (Task 5; el Review Focus 1 del plan quedó reescrito en el cierre):
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

- **Base de desarrollo de compose al cierre:** quedó con `GLP-10001…10005` vencidos, cuatro
  invitados, la cuenta `martina.b4.*` y jobs diferidos en Redis; `docker compose down -v` la
  vacía.

### Commits

| Commit    | Qué                                                                                        |
| --------- | ------------------------------------------------------------------------------------------ |
| `3f00c5a` | Plan de B4                                                                                 |
| `ec4853f` | Pedidos, ítems, historial, envíos y reservas; secuencia `GLP-` (Task 1)                    |
| `b464242` | `changes` y `errors` en los problemas, sesión opcional, listas por ids sin caché (Task 2)  |
| `06150fb` | Dominio de cotización y pedidos; casos de uso de creación, lectura y vencimiento (Task 3)  |
| `60eaeab` | Repositorio Prisma con reserva atómica, cola de vencimiento, adaptadores y módulo (Task 4) |
| `e971083` | Rutas de cotización, pedidos y mis pedidos, con E2E de doble envío y concurrencia (Task 5) |
| `c8f24ea` | Esta bitácora, el ADR 0004 y el README de pedidos                                          |
| Cierre    | Review Focus 1 reescrito, spec §4.3, menores de código y de docs                           |

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
  - `expireDue` trae los pedidos con `findDue` y `expire` los vuelve a leer (N+1 de hasta 50).
  - `orderShippingAddress` (`domain/shipping.ts`) lanza `TypeError` (500) si `home` llega sin la
    dirección completa o `branch` sin destino: hoy lo garantizan los DTOs por rama.
  - `optionalSessionFromContext` devuelve cualquier sesión ya cargada (hoy ninguna ruta combina
    guards).
  - `prisma/seed.ts`: una línea de 130 caracteres en el TSDoc de `seed()`.
  - Si `create` falla por stock, el invitado creado en ese intento queda guardado (es inofensivo:
    el próximo pedido lo vincula).
  - Cosméticos: `ownerOf` sin tipo de retorno explícito; los constructores de
    `OrderNotFoundError` y `CartTotalTooBigError` sin TSDoc propio.
- **Tests:**
  - Faltan el total demasiado grande por culpa del envío y un `price_changed` de un kit.
  - Nada prueba que `POST /orders` siga bajo el límite global mientras el resto lo saltea.
  - Ningún `POST /orders` por HTTP con un kit, ni `POST /shipping/quote` con el método
    deshabilitado (los cubren los tests por debajo del HTTP).
  - El E2E de `expire` solo mira la clave `slug` de la caché, y ningún caso vence un pedido con el
    pago `rejected` o `cancelled`.
  - El spec del processor depende del campo privado `_worker` de `WorkerHost`.
  - Nada prueba que `POST /orders` siga bajo el límite global, ni el 503 de
    `GET /orders/{number}` con cookie y Redis caído.
  - Ningún `POST /orders` con kit por HTTP, ni `POST /shipping/quote` con un método deshabilitado
    (los cubren las Tasks 3 y 4 por debajo del HTTP).
  - `prisma.e2e-spec.ts`: el tercer test nuevo usa el producto que crea el segundo (falla con
    `-t`).

## B5 · Pagos con Mercado Pago (2026-11-03)

Plan: [`docs/superpowers/plans/2026-11-03-b5-pagos.md`](superpowers/plans/2026-11-03-b5-pagos.md)
(6 tareas en 5 olas). Decisiones de arquitectura en
[ADR 0005 · pagos con Mercado Pago](adr/0005-pagos-con-mercado-pago.md). Todavía no hay
credenciales de Mercado Pago, así que todo se construyó y se probó en `MP_MODE=simulated`. La
prueba contra el sandbox real queda armada: el E2E omitido y la guía del README ("Pagos con
Mercado Pago").

### Qué quedó

- **Esquema, SDK y entorno** (Task 1):
  - Migración `20261103154326_b5_pagos`, con tres enums (`payment_provider`, `refund_status` y
    `refund_reason`).
  - `payments`: un intento por fila, con montos aprobado y devuelto, ids de Mercado Pago,
    `init_point`, `challenge_url`, cuotas, tarjeta y pagador. El único parcial
    `payments_active_per_order_idx` (`(order_id) WHERE is_active`) está escrito a mano. También son
    únicos `idempotency_key` y `(provider, provider_payment_id)`.
  - `refunds`, con su propia `idempotency_key`, y `webhook_events`, único por
    `(provider, event_id)`.
  - SDK `mercadopago` 3.6.1, sin dependencias.
  - Variables `MP_MODE`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `PUBLIC_API_ORIGIN` y
    `MP_STATEMENT_DESCRIPTOR`. La API no arranca con `live` y alguna de las tres primeras faltante,
    ni con `production` + `simulated`.
  - El puerto `OrderPaymentsPort` (solo la interfaz).
- **Pedidos** (Task 2):
  - `Order.payment` (`OrderPaymentInfo`) se lee del último intento. `GET /orders/{number}` devuelve
    `challenge` solo mientras el pago está `action_required`.
  - `markPaid`, `markRefunded`, `isRefundable` y `orderPaidEvent`.
  - `PrismaOrderPaymentsAdapter`. `markPaid` corre en una transacción:
    `UPDATE orders … WHERE status = 'pending_payment'`, reservas a `committed`, `inventory` con
    `on_hand − q` y `reserved − q` ordenado por producto, historial `paid` (actor `provider`) y
    `order.paid`. Después borra la caché del catálogo.
  - El doble `InMemoryOrderPayments`.
- **Dominio y casos de uso** (Task 3, `src/modules/payments/{domain,application}`):
  - Puertos: pasarela, repositorio de pagos, eventos de webhook, cola, ajustes y logger.
  - `ApplyProviderPaymentCommand`, la máquina de estados única.
  - Los comandos de preferencia, tarjeta, cancelación, recepción y procesado del webhook,
    conciliación, reproceso de webhooks, `order.expired` y simulador, y `GetInstallmentsQuery`.
  - `PaymentOrderAccess` resuelve el 404 idéntico y el `409 order_not_payable`.
  - Todo sin Nest, con dobles en `test/support/payments.ts`.
- **Adaptadores y módulo** (Task 4):
  - `PrismaPaymentRepository`: `startAttempt` en una transacción, y `update` con
    `SELECT … FOR UPDATE`, que escribe `orders.payment_status` con el mismo `tx`. También
    `PrismaWebhookEventRepository`.
  - `MercadoPagoGateway` y su mapper (cuerpos del Ruling B-35, traducción de errores y cuotas por
    `fetch`), `SimulatedGateway`, el HMAC con `node:crypto` y `EnvPaymentsSettings`.
  - La cola `payment-webhooks` (`BullWebhookQueue` y `PaymentWebhooksProcessor`) y el consumidor
    del outbox `OutboxEventsProcessor` (`order.expired`).
  - `PaymentsSweep` cada 60 s: vencer, conciliar y retomar webhooks.
  - `PaymentsModule` con `useFactory`, y `createApp({ gateway })` para los E2E.
- **Rutas** (Task 5):
  - `PaymentsController`, con las cuatro rutas de pago (`@SkipThrottle()`, e
    `@Idempotent('payments')` en preferencia y tarjeta), y `WebhooksController`, con sus DTOs.
  - El simulador: `SimulatedMercadoPagoController`, `SimulatedModeGuard` y `simulated-pages.ts`,
    con su propia CSP.
  - El contrato pasa a **41 operaciones implementadas de 77**. Los casos 7 a 16 de
    `cardholderSchema` (documento de quien paga) se suman a los casos compartidos.
- **Docs** (Task 6):
  - Este apartado y el ADR 0005.
  - La guía del README ("Pagos con Mercado Pago"): cómo cobra, modo simulado, qué pasar para el
    sandbox, E2E del sandbox y la trampa de las notificaciones de prueba.
  - `.env.example` quedó como lo dejó la Task 1.

### Decisiones

Rulings de la planificación (ledger del flujo, B-34 a B-58; B-48 y B-49 no se usaron):

- **B-34 · API:**
  - Checkout Pro por preferencias y Checkout API por `/v1/payments`, detrás de
    `PaymentGatewayPort`. La API Orders queda para más adelante.
  - SDK 3.6.1, y `fetch` para las cuotas.
  - `X-Idempotency-Key` = la clave del intento.
  - Errores de token (`2006`, `2062`, `3003`, `3006`, `3008` y `4000`) → 422. El resto → 502
    `payment_gateway_error`.
- **B-35 · Datos que van a Mercado Pago:**
  - Preferencia:
    - Ítems por línea más `Envío`, `payer` y `external_reference` = número.
    - `notification_url` (solo en `live`) y las tres `back_urls` a `/checkout/resultado`, con
      `auto_return`.
    - Vencimiento en `reservedUntil` (`-03:00`), `GALPON MATES` y `metadata`.
    - Sin ticket ni cajero, hasta 12 cuotas y `binary_mode: false`.
  - Tarjeta: `capture: true`, `three_d_secure_mode: 'optional'` y `additional_info.items`.
- **B-36 · Modelo:** `payments`, `refunds` y `webhook_events`, sin `payment_methods`.
  `Order.payment` se lee de `payments`.
- **B-37 / B-38 · Webhook:**
  - Deduplica por el `id` del cuerpo o por `x-request-id`. Firma inválida → 401; sin secreto, 401
    siempre.
  - Registra, encola (con procesado en línea si Redis no responde) y responde 200.
  - El formato IPN responde 200 y se ignora. Nunca 404, 409 ni 422.
- **B-39 · Estados:**
  - Traducción completa de los estados de Mercado Pago.
  - Efectos sobre el pedido: pagado si la suma de los aprobados alcanza el total; devolución si el
    pedido ya estaba pagado, vencido o cancelado; `refunded` total → pedido `refunded` (el stock no
    vuelve).
  - Un estado final no retrocede.
- **B-40 · Respuesta inmediata:** `POST …/card` aplica el resultado en la misma llamada.
- **B-41 · Devolución automática** de duplicados y tardíos, con la fila de `refunds` creada antes
  de llamar a Mercado Pago. Si falla, queda `failed` (alerta de B6).
- **B-42 · Vencimiento con pago en curso:** conciliación 10 minutos después de `reserved_until` y
  cancelación a las 48 h. Una preferencia sin pagar no frena el vencimiento.
- **B-43 · Consumidor del outbox** en `payments`: `order.expired` → cancelar el intento y vencer la
  preferencia.
- **B-44 · Un intento activo:** un intento nuevo o `cancel-payment` cancela el anterior (y, como
  mejor esfuerzo, también en Mercado Pago). `cancel-payment` responde 204 siempre.
- **B-45 · `orders.payment_status`** es la fuente de `Order.paymentStatus` y se sincroniza en la
  misma transacción que el intento.
- **B-46 · Escrituras sobre pedidos en `orders`** (`OrderPaymentsPort`, exportado por
  `OrdersModule`, sin ciclo).
- **B-47 · Entorno:** `MP_*` y `PUBLIC_API_ORIGIN`. La public key va solo en la tienda.
- **B-50 · Cuotas:** en `live`, las de Mercado Pago (CFT y TEA salen de `labels`); en `simulated`,
  la tabla del mock. Unas cuotas no ofrecidas dan 422 en el simulador y `rejected` en Mercado Pago.
- **B-51 · Documento de quien paga:**
  - `DNI`: 7 u 8 dígitos, sin puntos ("DNI inválido").
  - Otro tipo: de 5 a 20 alfanuméricos ("Documento inválido").
  - El tipo es obligatorio.
  - Los casos 1 a 6 (`cardholderName`) se omiten: el nombre viaja dentro del token.
- **B-52 · `@SkipThrottle()`** en las cuatro rutas y el webhook.
- **B-53 · Historial:** `paid` y `refunded` con actor `provider`. `cancel-payment` no agrega filas.
- **B-54 · Eventos:** `payment.approved`, `payment.rejected`, `payment.refunded` y `order.paid`.
- **B-55 · Simulador del back:** tokens `sim_…`, titulares, páginas de checkout y desafío, y
  `resolve` (409 `intent_not_active` si el intento ya no está activo).
- **B-56 · Cola `payment-webhooks`** con `enableOfflineQueue: false` y cierre forzado de los
  workers.
- **B-57 · Sandbox:** E2E con `describe.skipIf(!MP_ACCESS_TOKEN)` y la guía del README.
- **B-58 · Olas:**
  - W1: Task 1. W2: Tasks 2 y 3 en paralelo.
  - W3: Task 4. W4: Task 5. W5: Task 6.

Decisiones tomadas en el camino:

- **`payment_status` desde el repositorio de pagos, con el mismo `tx`** (opción b de la revisión
  de la ola 2-3):
  - Es una excepción acotada al ADR 0001, asentada en el ADR 0005.
  - Solo sincroniza si el intento es el **vigente** (estaba activo, o el pedido no tiene otro
    activo). Así, un rechazo tardío de un intento ya reemplazado no pisa el del activo (Task 3,
    RED → GREEN).
- **`locate` busca primero por `providerPaymentId`** y después por el intento (Task 3). Si el
  webhook llega antes que la respuesta de la tarjeta, el pago queda registrado una sola vez y no se
  devuelve.
- **Un `approved` repetido retoma el efecto** (`resumeApproved`, revisión de la ola 2-3):
  - Si `markPaid` o la devolución tardía fallaron después de guardar el intento, el reintento los
    completa.
  - La rama del duplicado no se repite: devolvería al que sí pagó.
- **Webhooks sin procesar** (revisión de la ola 2-3):
  - Un duplicado de un evento que no se procesó se vuelve a encolar.
  - `ReprocessWebhookEventsCommand` retoma en línea los eventos recibidos entre hace 6 h y hace
    5 min.
- **Checkout Pro dividido con aprobados por menos del total:** a las 48 h se devuelven
  (`late_approval`, sin agregar un valor al enum) y el pedido vence.
- **`FOR UPDATE` en `update`** (Task 4): la respuesta de la tarjeta y el webhook del mismo pago en
  paralelo no repiten `payment.approved` ni confirman el stock dos veces. La mutación de control
  (sin el bloqueo) hace fallar el test.
- **Ítems de la preferencia** (Task 4):
  - Una línea cuyo total no se divide en pesos enteros va como `"<nombre> ×N"` con cantidad 1.
  - Si los ítems no suman el total, se cobra un solo ítem, `Pedido <número> · Galpón Mates`.
  - Así Mercado Pago nunca cobra otro monto que el del pedido.
- **Claves propias para cancelar y vencer** (revisión de la Task 4):
  - El SDK 3.6.1 guarda la `idempotencyKey` de la última llamada en el `MercadoPagoConfig`
    compartido, y los `PUT` de cancelar y vencer la heredaban.
  - Ahora llevan un UUID propio.
  - Lo prueba un spec con el SDK real y un `fetch` falso.
- **Decoradores propios** para `Idempotency-Key`, `x-signature`, `x-request-id`, `data.id` y
  `topic` (Task 5): con `@Headers()` y `@Query()`, Swagger publicaba parámetros que el contrato no
  tiene.
- **CSP propia en las páginas del simulador** (Task 5):
  - `default-src 'none'`, y el único script, permitido por su hash.
  - `form-action 'self' <tienda>`, porque el 302 vuelve a la tienda.
  - `frame-ancestors 'self' <tienda>`, sin `X-Frame-Options`.
- **Clave suelta y validar antes de cancelar** (revisión de la Task 5):
  - Tras un 502 o un 422 de la pasarela, la clave del intento cancelado pasa a
    `<clave>:released:<id>`. El reintento de la tienda con la misma clave ya no da 500.
  - `validateCardCharge` revisa token y cuotas (en el simulador) antes de tocar el intento activo.
- **Textos que el contrato no fija:**
  - "La marca de la tarjeta no es válida.".
  - "El banco emisor no es válido.".
  - "Completá los datos de quien paga.".
  - "Elegí si la tarjeta es de crédito o de débito.".
- **La migración se creó contra un Postgres descartable** (Task 1), no contra el de compose.

### Versiones reales instaladas

B5 instaló una sola dependencia: `mercadopago` 3.6.1 (Task 1; CommonJS con tipos propios y sin
dependencias transitivas). Ya figura en la tabla de versiones de B1 y en
`scripts/dependency-versions.json`.

Para la prueba en vivo se usó lo que ya tenía el front: Next.js 16.4.2 y Playwright 1.64.1
(Chromium headless). Docker Engine 28.4.0.

### Verificación

- **Suite completa en verde** (Task 6, sobre `16bb8b8` más estas docs):
  - `npm run typecheck`, `npm run lint` (versiones y fronteras) y `npm run format:check`.
  - `npm test`: 74 archivos, 741 tests.
  - `npm run test:e2e`: 17 archivos y 1 omitido (el del sandbox), 386 tests y 4 omitidos: los 3
    del sandbox y el que ya se omitía (235 s).
  - `npm run contract:check`: 3 archivos, 216 tests y 1 omitido. **41 operaciones implementadas y
    36 pendientes de 77**, sin diferencias.
- **Review Focus del plan, cubierto con tests:**
  1. **Nunca dos cobros válidos:**
     - Un segundo `APRO` con otra clave → 409 "El pedido ya está pagado.".
     - Un segundo aprobado que entra igual crea una sola devolución `duplicate_payment` y llama una
       vez a `refundPayment`. El stock se confirma una sola vez (unitarios y HTTP).
  2. **Avisos repetidos y desordenados:**
     - Una sola fila en `webhook_events` y un solo procesado.
     - Un `pending` después del `approved` no cambia nada.
     - Un `approved` tras `expired` → `late_approval`, y el pedido sigue `expired`.
  3. **Stock exacto al pagar:**
     - Mate ×2 y un kit → `on_hand` −3/−1/−1 y `reserved` −3/−1/−1, reservas `committed` y caché
       borrada.
     - Dos `markPaid` en paralelo → uno paga y el otro devuelve `null`.
  4. **Token y estado en las cuatro rutas:**
     - 404 idéntico, y 409 por `expired` y por `paid`.
     - `cancel-payment` repetido → 204, y con débito una sola cuota.
  5. **Firma del webhook:**
     - HMAC correcto → 200.
     - `v1` cambiado, sin `ts`, sin cabecera o sin secreto → 401, sin filas ni jobs.
     - `data.id` en mayúsculas y espacios en `x-signature` se aceptan.
- **Prueba en vivo de la tienda (Task 6):**
  - Back compilado (`node dist/main`) en el 3001 con `MP_MODE=simulated` y
    `STORE_ORIGIN=http://localhost:4300`, sobre el Postgres y el Redis de compose, migrado
    (`20261103154326_b5_pagos`) y sembrado.
  - Tienda compilada en modo `live` (`npm run build -w @galpon/store` y `next start --port 4300`):
    - Con el entorno en la misma línea (sin `.env.local`) y
      `NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000`.
    - El primer build falló con `Failed to collect page data for /tienda/[linea]` porque el back
      todavía no estaba arriba. Con el back andando, compiló.
  - Script de Playwright `live-store.mjs` en el workspace: **17 de 17 pasos en verde**. Capturas
    locales en `.superpowers/sdd/2026-11-03-b5-pagos/captures/` (git ignora esa carpeta):
    - **Aprobar** (cuenta de Lucía):
      - Registro, Mate Imperial Premium al carrito, retiro y "Mercado Pago" → `GLP-10015`
        (`b5-01-checkout-pagar-con-mercado-pago.png`).
      - "Pagar $39.999 con Mercado Pago" → preferencia 200 con el `initPoint` del simulador del
        back, y el intento `mp_redirect` activo en `none` (`b5-02-simulador-checkout-del-back.png`).
      - Aprobar → `/checkout/resultado`: "¡Gracias, Lucía!" y "Tu pedido GLP-10015 está
        confirmado.", con el carrito vacío ("Abrir carrito, 0 productos")
        (`b5-03-resultado-aprobado-gracias-lucia.png`).
      - En la base:
        - Pedido `paid`/`approved` e intento `approved`/`accredited` inactivo.
        - Reserva `committed`.
        - Historial `pending_payment` (cliente) → `paid` (`provider`).
        - Outbox `order.created`, `payment.approved` y `order.paid`.
      - **Stock del mate:** `inventory` 8/0 antes del pedido, 8/1 con la reserva (`maxQuantity` 7) y 7/0 después de pagar.
      - `/cuenta/pedidos` muestra "Pagado" (`b5-04-cuenta-pedidos-pagado.png`). El detalle
        muestra "Pago Aprobado · Mercado Pago" y el historial "Esperando el pago" → "Pagado"
        (`b5-05-cuenta-detalle-pagado.png`).
      - Una segunda preferencia sobre el pedido pagado → `409 order_not_payable` "El pedido ya
        está pagado.".
    - **Rechazar** (invitado, `GLP-10016`):
      - "El pago no se aprobó" y "La tarjeta no aprobó el pago."
        (`b5-06-resultado-rechazado.png`).
      - En la base: intento `rejected`/`cc_rejected_other_reason` inactivo y `payment.rejected` en
        el outbox.
      - "Probar con otro medio" → `cancel-payment` 204 y vuelta al paso de pago
        (`b5-07-probar-con-otro-medio.png`).
    - **Dejar pendiente** (`GLP-10017`):
      - "Estamos esperando la confirmación del pago" (`b5-08-resultado-pendiente.png`), con el
        intento `pending`/`pending_waiting_payment`.
      - Con `reserved_until` movido al pasado, la lectura **no** lo vence.
      - `cancel-payment` → 204, y la lectura siguiente lo vence (`expired`/`cancelled`, reserva
        `released`) (`b5-09-pendiente-cancelado-y-vencido.png`).
    - **Tarjeta con la public key de mentira** (`GLP-10018`):
      - Los Secure Fields reales **cargan**: tres `iframe` de `secure-fields.mercadopago.com`
        (`b5-10-tarjeta-secure-fields-sin-public-key.png`).
      - Con la Visa de prueba, el SDK hace `POST /v1/devices/widgets` (200) y
        `GET /v1/payment_methods/search` (404).
      - La tienda marca "Número incompleto", no habilita vencimiento, CVC ni cuotas, y "Pagar
        $39.999" no llama al back (`b5-11-tarjeta-pagar-sin-public-key.png`).
      - El pago con tarjeta desde la tienda se prueba con el sandbox.
    - **3DS simulado por API**, sobre ese mismo pedido (token `sim_3DS_3704_…`):
      - 200 `action_required`, con `challenge.url` =
        `http://localhost:3001/api/v1/__simulated/mercadopago/challenge?…`.
      - El resultado muestra "Falta verificar la compra con tu banco" con "Pagar de nuevo", y sin
        "Verificar con mi banco" (`b5-12-resultado-3ds-sin-url.png`).
      - **Diagnóstico de la CSP:**
        - Aun con esa URL escrita a mano en `galpon.order`, la tienda no abre el diálogo:
          `readOrderSession` solo acepta `https:` o una ruta propia.
        - Un `iframe` agregado a mano lo bloquea la CSP de la tienda (`frame-src 'self'
https://*.mercadopago.com https://*.mercadolibre.com https:` no admite
          `http://localhost:3001/`; `b5-13-csp-bloquea-desafio-http.png`).
        - No se tocó el front.
      - El desafío del back en su propia pestaña (`b5-14-desafio-3ds-del-back.png`) → Confirmar →
        "Listo. Ya podés cerrar esta ventana." (`b5-15-desafio-listo.png`).
      - El resultado pasa a "¡Gracias, Lucía!" con "Tarjeta terminada en 3704"
        (`b5-16-resultado-3ds-aprobado-tarjeta-3704.png`): pedido `paid`, reserva `committed` e
        historial `paid` (`provider`).
  - **Barrido y consumidor de `order.expired` en vivo:**
    - Tres pedidos de una corrida anterior del script, que se cortó, quedaron con una preferencia
      sin pagar (intento `none`).
    - Con `reserved_until` movido al pasado, el barrido los venció a los 52 s, sin ninguna lectura.
    - El consumidor del outbox dejó cada intento `cancelled` e inactivo.
    - El catálogo quedó con `reserved` en 0.
  - **Logs del back:**
    - Ningún `warn` ni `error` en toda la prueba.
    - Las 41 apariciones de `x-order-token` salen como `[Redacted]`.
    - No hay ningún `ot_…` en claro ni ningún token `sim_…`.
  - **Consola de la tienda** (nota para el front): el SDK de Mercado Pago intenta cargar imágenes
    de `www.mercadolibre.com` y `www.mercadolivre.com` (huella del dispositivo), y la CSP
    (`img-src`) las bloquea.
  - **Corridas anteriores:**
    - Las dos primeras corridas se cortaron por errores del propio script: leía el cuerpo de la
      preferencia después de que la tienda navegara al simulador, y buscaba un `main` que la
      pantalla del resultado no tiene.
    - Una tercera corrida, lanzada por error en segundo plano, se cortó a mano después de pagar
      `GLP-10014`.
    - No hubo nada que corregir en el back ni en la tienda. Por eso la corrida final arranca en
      `GLP-10015`.
  - **Al cierre:**
    - No quedan procesos en el 3001, el 4300 ni el 5273, ni contenedores de compose.
    - El front no tiene cambios. El build de `apps/store/.next` queda en modo `live`, ignorado por
      git.
- **Base de desarrollo de compose al cierre:**
  - Pedidos `GLP-10006…10018`: pagados `10009`, `10010`, `10013`, `10014`, `10015` y `10018`, y el
    resto vencidos.
  - Cuentas `lucia.b5.*@example.com` e invitados `lucia.*@ejemplo.com`.
  - El Mate Imperial Premium quedó con `on_hand` 6, por los seis pagados.
  - `docker compose down -v` la vacía.

### Commits

| Commit    | Qué                                                                                          |
| --------- | -------------------------------------------------------------------------------------------- |
| `8f403c1` | Plan de B5                                                                                   |
| `3c8a6bd` | Intentos de pago, devoluciones y eventos de webhook; SDK y variables `MP_*` (Task 1)         |
| `4475430` | Puerto de pagos en pedidos: pagar con reservas confirmadas, devolver, `Order.payment` (T2)   |
| `39a81b0` | Dominio y casos de uso de pagos (Task 3)                                                     |
| `305d3b4` | Revisión de la ola 2-3: `resumeApproved`, webhooks sin procesar, aprobado parcial a las 48 h |
| `fa0d80e` | Repositorios Prisma, pasarelas real y simulada, firma, colas y módulo (Task 4)               |
| `38c6053` | Revisión de la Task 4: claves idempotentes propias para cancelar y vencer                    |
| `2cea8fb` | Rutas de pago y webhook del contrato, simulador y E2E (Task 5)                               |
| `16bb8b8` | Revisión de la Task 5: reintento tras un 502 o un 422 y validar antes de cancelar            |
| `d4b5e72` | Esta bitácora, el ADR 0005 y la guía de pagos y del sandbox del README (Task 6)              |
| `d558a69` | Revisión de la Task 6: `STORE_ORIGIN` HTTPS público para Checkout Pro                        |
| `dd68f40` | Cierre: reseñas del seed al día con el front (18 y 10 destacadas) y menores de docs          |
| `dc51361` | Cierre: reintento con la misma clave retoma el intento; pedido vencido devuelve aprobados    |

### Lo que queda para B6 en adelante

**Con las credenciales del sandbox (Lucas):**

- Correr `mercadopago.sandbox.e2e-spec.ts` con `MP_PUBLIC_KEY`.
- Hacer la compra completa desde la tienda (spec §11):
  - con la public key de prueba;
  - Checkout Pro con la cuenta compradora, en incógnito;
  - el webhook por un túnel HTTPS.
- Confirmar:
  - el `status_detail` real de cada titular;
  - si Mercado Pago acepta `back_urls` de `localhost` con `auto_return`;
  - el 3DS real: Mercado Pago pide un `POST` del `creq` a `external_resource_url`, y el contrato
    solo lleva `challenge.url`.

**Casos raros anotados (sin arreglo, inofensivos):**

- Un pedido `pending_payment` con un intento `approved` que no se pudo marcar pagado se retoma con
  el reintento del job, el webhook repetido, el reproceso de notificaciones (de 5 min a 6 h) o un
  reintento de la tienda con la misma clave; pasadas 6 h ningún barrido lo mira (la conciliación
  solo lista `pending` y `action_required`).
- Si el aviso de Mercado Pago llega antes que la respuesta del cobro con tarjeta, el intento de la
  tarjeta queda activo en `none` sobre un pedido ya pagado: un pago nuevo da 409 y
  `payment_status` sigue `approved`.
- En `live`, un 422 de token o de cuotas se conoce recién al cobrar, así que el intento activo
  anterior ya quedó cancelado (también en Mercado Pago). El simulador valida antes de cancelar.
- Un duplicado aprobado que se corta entre guardarse y pedir la devolución no se retoma: un
  reintento no sabe cuál de los dos aprobados pagó el pedido. Si la devolución quedó `failed`, la
  muestra la alerta de B6; si no llegó a crearse, queda para revisar a mano en Mercado Pago.

**Para B6 (admin):**

- Alertas del dashboard:
  - desde `refunds` con `status = failed` ("Devolvelo desde Mercado Pago");
  - desde `payment_status` `in_dispute` y `charged_back`.
- Devolución manual (`reason = manual`).
- Los pedidos de la demo `GLP-09001…09012`.

**Para B7 (emails):**

- Consumir `order.paid`.
- Con un segundo consumidor del outbox, extraer a `shared` un despachador por tipo. Hoy
  `OutboxEventsProcessor` (de `payments`) acepta y descarta todo lo que no es `order.expired`.

**Para B8 (producción):**

- `trust proxy` y límites por sesión: las rutas de pago y el webhook no tienen límite.
- Que el interceptor de idempotencia espere al pedido en curso. Hoy, un
  `409 idempotency_in_progress` en una ruta de pago la tienda lo muestra como "Tu pedido venció o
  ya no se puede pagar".
- Purgar las `idempotency_keys` vencidas.

**Más adelante:**

- La API Orders de Mercado Pago (migración detrás de `PaymentGatewayPort`).
- `payment_methods` (tarjetas guardadas).
- Conciliar un Checkout Pro del que nunca llegó ningún aviso:
  - hoy el intento queda en `none` y el pedido vence;
  - habría que buscar el pago por `external_reference` (`GET /v1/payments/search`).

**Para el front** (no se tocó; lo vieron la prueba en vivo y la revisión de la Task 5):

- `isChallengeUrl` solo acepta `https:`, así que el 3DS simulado (`http://localhost:3001`) no se
  ve en la tienda compilada local.
- El listener del `postMessage` filtra por el origen de la tienda, así que el diálogo no se cierra
  solo con el desafío del back: queda el botón "Ya terminé".
- La CSP (`img-src`) bloquea las imágenes de huella del SDK en `mercadolibre.com` y
  `mercadolivre.com`.

**Abiertos de los reportes de las tareas:**

- Devoluciones que no se retoman:
  - Un corte entre guardar un segundo aprobado y crear su devolución (duplicado) no se retoma.
  - Un `markRefunded` que falla deja el pedido `paid` con `payment_status = refunded`.
- Un pedido `pending_payment` con `payment_status = approved` (corte entre el intento y
  `markPaid`) se retoma solo mientras el evento esté dentro de la ventana de 6 h.
- Webhook y respuesta de la tarjeta **en paralelo**, en intentos distintos:
  - el segundo choca con el único `(provider, provider_payment_id)`;
  - la tarjeta respondería 500 aunque el pago entró;
  - el webhook se reintenta y cae bien.
- Con Mercado Pago real:
  - Un token o unas cuotas inválidas se saben recién al cobrar, cuando el intento activo anterior
    ya quedó cancelado.
  - Una caída entre `createCardPayment` y el `update` del `catch` deja la clave tomada.

**Menores anotados en las revisiones:**

- **Código:**
  - `refunds` sin índice en `payment_id` (Postgres no indexa las FK).
  - `refundPayment` usa `PaymentRefund.create` sin cuerpo. El método del SDK para una devolución
    total es `PaymentRefund.total` (manda `{}`). Confirmarlo con el sandbox.
  - El SDK reintenta 3 veces los 429, los 5xx y los errores de red (a los 1, 2 y 4 s): un cobro
    puede tardar unos 47 s antes del 502. Considerar `maxRetries: 1`.
  - `update` no vuelve a chequear "un estado final no retrocede" dentro del `FOR UPDATE` (la
    ventana es muy corta).
  - La conciliación consulta a Mercado Pago cada 60 s por cada pedido pendiente, sin backoff. Con
    el tope de 50, los más viejos pueden dejar sin atender a los nuevos.
  - `payment-webhooks` no tiene `removeOnFail`: los jobs que agotan los 5 intentos quedan en Redis.
  - Helpers de `orders/infrastructure` importados desde `payments` (`UUID_PATTERN`,
    `TRANSACTION_OPTIONS`, `assertDate`, `assertBatchLimit`, `WORKER_SHUTDOWN_PROBE_MS` y
    `closeWorker`): moverlos a `src/shared/infrastructure`.
  - `ORDER_PAID_EVENT` y `orderPaidEvent` están repetidos en `payments/domain/payment-events.ts`
    y `orders/domain/order-events.ts`.
  - `InMemoryOrderPaymentsStub` sigue al lado del doble oficial.
  - El `fromStatus` del historial de `markRefunded` y el `payment` que devuelve `markPaid` se leen
    antes de la transacción.
  - El replay idempotente responde antes de mirar el token: repetir clave y cuerpo sin
    `X-Order-Token` devuelve el 200 guardado (hay que conocer la UUID).
  - El controlador del simulador:
    - inyecta `PAYMENT_REPOSITORY` y `ORDER_PAYMENTS_PORT` (mejor una query chica en
      `application`);
    - sus errores salen como JSON en el navegador (el mock muestra una página);
    - los botones (`#009ee3` sobre blanco) dan un contraste de unos 3:1.
  - `SimulatedGateway.payments` crece sin límite (solo en dev y test).
  - El TSDoc de `env.schema.ts` dice que las reglas entre variables solo se revisan si cada una es
    válida, pero Zod 4 las corre igual.
- **Tests:**
  - `webhooks.controller.spec.ts` ata los jobs a las filas: solo vale por ser el primer test.
  - Dos descripciones de `payments.e2e-spec.ts` prometen más de lo que comprueban ("ni encolar",
    "concilia").
  - `createApp({ gateway })` levanta una segunda app, con sus workers, sobre las mismas colas
    (posible fuente de flakiness).

## B5c · Combos y aviso a la tienda (2026-11-03)

Plan: [`docs/superpowers/plans/2026-11-03-b5c-combos.md`](superpowers/plans/2026-11-03-b5c-combos.md)
(5 tareas en 3 olas: 1 ∥ 2, 3 ∥ 4 y el cierre). Decisiones de arquitectura en
[ADR 0006 · combos y aviso a la tienda](adr/0006-combos-y-aviso-a-la-tienda.md). El contrato salió
de la rama `feat/inicio-combos` del front (worktree `../frontend-inicio-combos`), que Lucas ya
mergeó en el `main` local del front (`063c091`).

### Qué quedó

- **Esquema, seed y dominio** (Task 1):
  - Migración `20261103231832_b5c_combos`: enums `combo_status` y `line_type` + `combo`, tablas
    `combos` y `combo_items`, y `order_item_components.position`. A mano: `combos_price_ars_check`
    (1 a 99.999.999), `combos_position_check` (≥ 1), `combo_items_position_check` (1 a 3) y el
    relleno de `position` de los kits viejos por rol (mate 1, bombilla 2, yerba 3). Ninguna
    sentencia usa el valor `'combo'` (Postgres no deja usarlo en la transacción que lo agrega).
  - `scripts/import-fixtures.mjs` lee `FIXTURE_COMBOS` si las fixtures lo exportan (si no,
    `SEED_COMBOS = []`) y genera `prisma/seed-data/combos.ts`: 5 combos, 4 publicados.
    `seedCombos` hace `upsert` por un UUID v5 de la clave del mock y no toca los combos del
    dashboard.
  - Dominio en `catalog/domain/combo.entity.ts` (`comboLineAmounts`, `hasDistinctGroups`,
    `comboHasMate`, el mensaje del precio con la suma) y `combo-errors.ts`. `formatPesos` se mudó a
    `src/shared/domain/format-pesos.ts`.
- **Despachador del outbox y aviso a la tienda** (Task 2):
  - `OutboxHandlerRegistry` y `OutboxDispatcherProcessor` en `src/shared/infrastructure/outbox/`,
    con `closeWorker` y `redisAnswers` en `src/shared/infrastructure/redis/close-worker.ts`.
    `payments` pasó a `OrderExpiredOutboxHandler` (el viejo `OutboxEventsProcessor` se borró; sus
    tests se mudaron con los mismos nombres).
  - Módulo `storefront-sync`: `STOREFRONT_TAG_PATTERN`, `StorefrontPort`, `HttpStorefrontAdapter`
    (5 s; sin seguir redirecciones), la cola `storefront-revalidate` (8 intentos, backoff
    exponencial desde 1 s, `jobId` = id del evento), `StorefrontOutboxHandler` y
    `StorefrontRevalidateProcessor` (rechazo → `UnrecoverableError`).
  - `STORE_REVALIDATE_SECRET` (mínimo 32; opcional fuera de `production`, con un aviso al
    arrancar si falta; obligatorio en `production`).
- **Combos en el catálogo** (Task 3):
  - Casos de uso con `useFactory` (`ListCombosQuery`, `ListAdminCombosQuery`, `CreateComboCommand`,
    `UpdateComboCommand`, `DeleteComboCommand` y `ReorderCombosCommand`), `combo-views.ts` (la vista
    del mock), `combo-rules.ts` (las reglas 1 a 7 del mock) y `PrismaComboRepository`, sin caché.
  - `CombosController` (`GET /combos`, sin límite por IP) y `AdminCombosController` (sesión de
    admin; las escrituras también con CSRF). Cada escritura guarda `combo.changed` en su
    transacción.
  - `EachItem` en el pipe de validación: un error por elemento en `productIds.N` e `ids.N`
    ("Requerido"), compartido por HTTP y por los casos de validación del contrato (Ruling B-64).
  - Contrato: **47 operaciones implementadas de 83** y los casos de `comboFormSchema` y
    `comboOrderSchema`.
- **El combo como línea** (Task 4): `ComboCartItem` y la rama combo de `priceCart` (la del mock con
  las diferencias del plan), `findCombosForCart` en `CatalogProductsAdapter` (sin caché),
  `order_item_components.position` al guardar y `toLine` ordenando por `position` y después por
  grupo. En el contrato, `ComboCartItemInput`, el tercer `oneOf` de `CartItemInput` y
  `OrderLine.kitItems.minItems: 2`.
- **Menores de la revisión** (`460a88f`): el adaptador de la tienda no sigue redirecciones (un 3xx
  es un rechazo), los UUID en mayúsculas del dashboard se pasan a minúsculas, `comboSeedId` valida
  la clave, los E2E de Prisma no dependen entre sí, el 401 sin sesión en todas las rutas de
  `/admin/combos`, el 422 de `options` de un combo con mate por HTTP, TSDoc y el README del seed.
- **Docs** (Task 5): este apartado, el ADR 0006 y el README ("Combos y aviso a la tienda", el
  contrato con `CONTRACT_PATH`, el orden de los push para la CI, el seed y los tests).

### Decisiones

Rulings de la planificación (B-59 a B-68):

- **B-59 · Contrato:** el del worktree, por `CONTRACT_PATH`, con su `validation-cases.json`. Donde
  el contrato solo da un ejemplo, manda el mock.
- **B-60 · Modelo:** el de la investigación, sin único en `combos.position` (los listados ordenan
  por `position` y después por `created_at`), con la PK de `order_item_components` sin cambios y
  **sin `combo_id` en `order_items`**: la línea es una copia.
- **B-61 · Dónde y sin caché:** en `catalog`, con repositorio propio y sin Redis. Un id que no es
  UUID es "no existe".
- **B-62 · Vista:** la de `toCombo` del mock. `GET /combos` = publicados con todas sus piezas
  publicadas y con precio (los agotados salen con `isSoldOut`); `GET /admin/combos` = todos.
- **B-63 · Dashboard:** las reglas del mock, literal; alta en `max + 1`; `PATCH` conserva la
  posición; `DELETE` renumera; el orden tiene que traer todos los combos una vez.
- **B-64 · Errores por índice:** `EachItem`, sin cambiar ningún otro DTO.
- **B-65 · Carrito y pedido:** combo inexistente, en borrador, con una pieza que no se vende o con
  piezas de grupos repetidos → `unavailable` (nunca un 500); `price_changed` contra el precio del
  combo, con `productId: null`; stock compartido; `kitItems` en el orden del combo.
- **B-66 · Aviso a la tienda:** `combo.changed` en la misma transacción, despachador compartido con
  handlers registrados en el constructor y `storefront-sync` con su propia cola.
- **B-67 · Seed:** `FIXTURE_COMBOS` opcional, UUID v5 por clave.
- **B-68 · Olas:** las tareas paralelas tocaron solo sus archivos; las diferencias de contrato de la
  otra tarea se anotaron sin arreglarlas.

Desvíos de las tareas (todos en sus reportes):

- `isComboForSale` y `isPurchasable` también exigen piezas de grupos distintos (el mock no lo mira):
  un combo así no sale en `GET /combos` y en `/admin/combos` sale con `isPurchasable: false`.
- Un combo con menos de 2 o más de 3 piezas vendibles da `unavailable` en la cotización (la base no
  lo permite, pero sin el chequeo `comboLineAmounts` tiraría un 500).
- `netPriceArs` del combo con un `netPriceOf` local, para que `catalog` no dependa de
  `orders/domain`.
- El repositorio lee el combo con sus piezas **después** del commit: con `include` anidado dentro
  de la transacción, Prisma 7 manda consultas en paralelo por la misma conexión y `pg` avisa un
  `DeprecationWarning`.
- Un caso válido de `validation-cases.json` sin `output` solo tiene que pasar (como dice el README
  del contrato); antes se comparaba con `{}`.
- `DeleteComboCommand` responde 404 con un id en blanco, y un `ids` que no es lista da "Requerido".

### Versiones reales instaladas

B5c no instaló nada. Para la prueba en vivo se usó lo que ya tenía el worktree del front: Next.js
16.4.2, Vite 8.3.4 y Playwright 1.64.1 (Chromium headless). Docker Engine 28.4.0.

### Verificación

- **Suite completa en verde** (Task 5, sobre `460a88f` más estas docs):
  - `npm run typecheck`, `npm run lint` (versiones y fronteras) y `npm run format:check`.
  - `npm test`: 87 archivos, 903 tests.
  - `npm run test:e2e`: 18 archivos y 1 omitido (el del sandbox), 463 tests y 4 omitidos (207 s).
  - `npm run contract:check`, con `CONTRACT_PATH="../frontend-inicio-combos/docs/api/openapi.yaml"`
    y sin él (el `main` local del front ya tiene los combos): 3 archivos, 244 tests y 1 omitido.
    **47 operaciones implementadas y 36 pendientes de 83**, sin diferencias.
- **Review Focus del plan, cubierto con tests:**
  1. **Stock compartido:** "Dúo Imperial" ×10 y el Mate Imperial suelto ×5 con stock 12 → la línea
     suelta queda `quantity_reduced` a 2, y el pedido reserva 12 del mate y 10 del bombillón.
  2. **Combo roto después de guardado:** con una pieza archivada o movida a otra línea del mismo
     grupo, `GET /combos` no lo muestra, `/admin/combos` lo muestra con `isPurchasable: false`, la
     cotización da `unavailable` y `POST /orders` responde 409 `stock_changed`, nunca 500.
  3. **Guardar y verlo al instante:** con una tienda falsa (`node:http`), cada alta, edición, orden
     y borrado manda un solo `POST /api/revalidate` con `{"tags":["combos"]}` y el secreto; con 500
     se reintenta; con 401 no (job `failed` con un intento); un 401, 403, 404 o 422 del dashboard
     no deja ningún `combo.changed`.
  4. **Orden de las piezas:** un combo `[yerba, mate]` sale así en `GET /combos`, en el `detail`
     de la cotización y en los `kitItems` del pedido; un kit viejo sigue mate, bombilla, yerba.
  5. **Orden y borrado:** un orden con un id de más, de menos, repetido o que no es UUID → 422 sin
     cambios; borrar el segundo de cuatro deja 1, 2, 3.
- **Prueba en vivo con la tienda y el dashboard (Task 5):**
  - Back compilado (`node dist/main`) en el 3001 con `MP_MODE=simulated`,
    `STORE_ORIGIN=http://localhost:4320`, `ADMIN_ORIGIN=http://localhost:5320` y
    `STORE_REVALIDATE_SECRET` igual al `REVALIDATE_SECRET` de la tienda (64 hex inventados para la
    prueba, en un archivo fuera del repo), sobre el Postgres y el Redis de compose, migrado y
    sembrado.
  - Tienda y dashboard compilados en modo `live` desde `../frontend-inicio-combos` (el mismo
    commit que el `main` del front), con el entorno en la misma línea y sin `.env.local`:
    `next start --port 4320` y `vite preview --port 5320 --strictPort`. El `next dev` del 3000 y
    el `vite dev` del 5173 de Lucas no se tocaron.
  - Antes de involucrar al back, `POST http://localhost:4320/api/revalidate` respondió
    `{"revalidated":["combos"]}` con el secreto y 401 "El secreto de revalidación no es válido."
    con otro.
  - Script de Playwright `live-combos.mjs` en el workspace: **9 de 9 pasos en verde**. Capturas en
    `.superpowers/sdd/2026-11-03-b5c-combos/captures/` (git ignora esa carpeta):
    - **Precio desde el dashboard:**
      - El inicio de la tienda mostraba los 4 combos publicados y "Dúo Imperial" a $61.999
        (`b5c-01-tienda-antes.png`).
      - Ingreso con el admin semilla y pantalla Combos con los 5 combos ("Galleta y Canarias" en
        borrador y sin stock) (`b5c-02-dashboard-combos.png`).
      - "Acciones de Dúo Imperial" → Editar → precio 59999 (`b5c-03-dashboard-editar-precio.png`)
        → Guardar → `PATCH` 200 (`priceArs` 59999, `savingsArs` 8999) y "Cambios guardados."
        (`b5c-04-dashboard-cambios-guardados.png`). En la base, un `combo.changed` `updated`
        publicado.
      - **La primera recarga del inicio, a los 1,7 s del guardado, ya mostró $59.999** con "Ahorrás
        $8.999" (`b5c-05-tienda-despues.png`), y el log del back tenía
        `La tienda regeneró combos (evento combo.changed)` (`StorefrontRevalidateProcessor`).
    - **Orden desde el dashboard:** "Subir Camionero y Canarias" → `PUT /admin/combos/order` 204 y
      "Orden guardado.". La recarga a los 0,5 s todavía mostraba el orden viejo (la tienda sirve lo
      anterior mientras se regenera) y la de los 2,2 s ya empezaba por "Camionero y Canarias"
      (`b5c-06-tienda-orden-nuevo.png`), con una segunda línea "La tienda regeneró combos".
    - **Compra de un combo** (invitada, `GLP-10019`):
      - "Dúo Imperial" con cuero Marrón y virola Acero desde la tarjeta del inicio. El carrito
        muestra "Mate Imperial Premium + Bombillón Premium Curvo · Cuero marrón · Acero", $59.999
        y "Ahorrás $8.999" (`b5c-07-carrito-con-el-combo.png`).
      - Checkout con retiro y "Mercado Pago" → `POST /orders` 201 con una línea `combo`
        (`unitPriceArs` 68.998, `kitSavingsArs` 8.999, `totalArs` 59.999, `options` Marrón/Acero)
        (`b5c-08-checkout-pagar-con-mercado-pago.png`). Inventario de las dos piezas: 12/0 → 12/1.
      - Simulador del back (`b5c-09-simulador-del-back.png`) → Aprobar → "Tu pedido GLP-10019 está
        confirmado.", con "Dúo Imperial", sus piezas y el ahorro (`b5c-10-resultado-aprobado.png`).
      - `GET /orders/GLP-10019`: `paid`/`approved`, línea `combo` con `productSlug: null`, el
        `detail`, las `options` y `kitItems` Mate Imperial Premium ($39.999) y Bombillón Premium
        Curvo ($28.999), en el orden del combo. En la base, `order_item_components` con `position`
        1 (mate) y 2 (bombilla), reservas `committed` e inventario 11/0 de cada pieza.
  - **Lo que el front no deja hacer todavía** (no es del back): el diálogo "Editar combo" muestra
    "No pudimos cargar los productos." en las piezas, porque las lista con `GET /admin/products`
    (404 hasta B6). El precio, el nombre, la descripción y el estado se guardan igual; crear un
    combo o cambiarle las piezas desde el dashboard espera a B6. Los demás 4xx de la prueba son los
    esperados: `GET /me` 401 (invitada), `GET /admin/auth/me` 401 antes del ingreso y
    `/admin/dashboard/summary` y `/admin/settings` 404 (B6).
  - **Logs:** ningún `warn` ni `error` en el back. El secreto no aparece ni en el log del back ni
    en el de la tienda.
  - **No se probó en vivo** (lo cubren los E2E con la tienda falsa): la tienda caída con reintentos
    y el secreto equivocado del lado del back. Tampoco qué sirve la tienda después de un
    `next start` nuevo (pregunta 6 de la investigación).
  - **Al cierre:**
    - Un `npm run db:seed` devolvió los combos a la semilla ("Dúo Imperial" $61.999 y el orden
      original). `GLP-10019` queda pagado en la base de compose.
    - No quedan procesos en el 3001, el 4320 ni el 5320, ni contenedores de compose.
    - Los dos fronts sin cambios y sin `.env.local`. Los builds de `apps/store/.next` y
      `apps/admin/dist` del worktree quedan en modo `live`, ignorados por git.

### Commits

| Commit    | Qué                                                                                   |
| --------- | ------------------------------------------------------------------------------------- |
| `3be34b9` | Plan de B5c                                                                           |
| `8ede063` | Combos y sus piezas, línea de pedido combo, seed de combos y dominio (Task 1)         |
| `0988392` | Despachador compartido del outbox y aviso a la tienda (`storefront-sync`) (Task 2)    |
| `ce23105` | El combo como línea del carrito y del pedido, con la reserva de cada pieza (Task 4)   |
| `67561c0` | Combos para la tienda y el dashboard, con aviso a la tienda al guardar (Task 3)       |
| `460a88f` | Menores de la revisión: redirecciones, ids en mayúsculas, 401 en todas las rutas, E2E |
| (este)    | Esta bitácora, el ADR 0006 y el README (Task 5)                                       |

**Para que la CI del back pase:** Lucas pushea primero el `main` del front (con los combos,
`063c091`) y después el `main` del back. La CI clona el `main` remoto del front para el contrato;
si el back llega antes, compara contra el contrato sin combos y falla.

### Lo que queda para B6 en adelante

**Para B6 (admin):**

- `GET /admin/products`: el diálogo de combos lo usa para listar las piezas. Con él se pueden crear
  combos y cambiarles las piezas desde el dashboard.
- Avisar `products` a la tienda con los cambios de stock y de precio: los combos y los productos
  del inicio muestran el agotado y la cantidad máxima de la última regeneración (hoy, una compra
  no regenera nada hasta que vence la caché de la tienda). El despachador ya admite un handler más
  por tipo de evento (`order.created`, `order.expired`, `order.paid`).
- Ver qué sirve la tienda después de un `next start` nuevo (el prerender del build o lo último
  regenerado) y si hace falta un "regenerar todo" al arrancar.

**Menores aceptados:**

- `max + 1` y el reordenamiento no toman un lock: dos altas simultáneas pueden compartir
  `position` (desempata `created_at`, y el próximo orden o borrado lo corrige). Con un solo admin
  alcanza.
- El relleno de `order_item_components.position` de la migración no tiene test (las migraciones se
  aplican sobre una base vacía).
- El despachador del outbox corre con concurrencia 1 para todos los tipos: un `order.expired` lento
  (llamadas a Mercado Pago) demora los avisos a la tienda.
- `STOREFRONT_TAG_PATTERN` es una copia del patrón de la tienda: si la tienda cambia sus etiquetas,
  hay que actualizarlo.

## B6 · Dashboard completo (2026-11-04)

Plan: [`docs/superpowers/plans/2026-11-04-b6-admin.md`](superpowers/plans/2026-11-04-b6-admin.md)
(8 tareas en 5 olas: 1 ∥ 2, 3 ∥ 4, 5, 6 ∥ 7 y el cierre). Decisiones de arquitectura en
[ADR 0007 · dashboard completo](adr/0007-dashboard-completo.md). Con B6 el back tiene las **83
operaciones del contrato**. Desde la ola de cueros (Task 5) el contrato salió de la rama
`feat/ajustes-tienda` del front (worktree `../frontend-ajustes`, contrato de cueros en `6a5cd30`),
que hoy está en el `main` local del front (`24b62ab`).

### Qué quedó

- **Contenidos y ajustes** (Task 1, 14 operaciones): `GET/PUT /admin/content/*` (los 7
  contenidos) y `GET/PUT /admin/settings`. Migración `20261104151808_b6_settings_version`
  (`settings.version` y `settings.updated_by`, `ON DELETE SET NULL`). Guardan `version + 1` y
  `updated_by`, borran su clave de Redis después del commit y avisan a la tienda. Nosotros guarda
  las fotos de los socios con `resolveImage`. El dominio `media` (`MEDIA_FOLDERS`, `mediaUrl`,
  `resolveImage`) y `MEDIA_MODE` en la configuración nacieron acá.
- **Aviso genérico y caché con versión** (Task 2): `storefrontStaleEvent(reason, tags)` en
  `src/shared/domain/storefront-tags.ts` (con `STOREFRONT_TAG_PATTERN`, que se mudó ahí), mapeado
  1 a 1 por `storefront-sync`. Las claves del catálogo pasan a `catalog:v{n}:…` con
  `CachePort.incr` y `bumpCatalogCacheVersion`. `order.created`, `order.paid` y `order.expired`
  suman `storefront.stale` (`products`, `combos`) en su transacción, y los pedidos borran las
  claves de sus productos con la versión leída después del commit. `test/support/fake-store.ts`
  quedó reusable.
- **Pedidos del dashboard** (Task 3, 3 operaciones): listado con filtros y búsqueda sin acentos
  (`search-text.ts`), detalle y `POST /admin/orders/{number}/status` con las transiciones y los
  409 del mock (`UPDATE` condicional: dos despachos simultáneos dan 200 y 409). Cancelar libera la
  reserva y cierra el intento activo en la misma transacción (ADR 0001, la inversa de B-45);
  `OnOrderCancelledCommand` de `payments` hace lo de la pasarela. Eventos `order.shipped`,
  `order.delivered` y `order.cancelled` (para los mails de B7).
- **Contacto, arrepentimiento, bandeja y reseñas** (Task 4, 7 operaciones): módulo `support`
  (`contact_messages`, migración `20261104154904_b6_support`, código `ARR-` + 6 dígitos de
  `withdrawal_code_seq`), `POST /contact`, `POST /withdrawals`, la bandeja del dashboard,
  `POST /products/{slug}/reviews` (queda pendiente) y la moderación (`GET/PATCH /admin/reviews`),
  que sube la versión de la caché. `RootRule` en el pipe para los errores de raíz
  ("Mandá al menos un cambio").
- **Cueros por producto** (Task 5): `products.leathers text[]` con CHECK (migración
  `20261104180720_b6_leathers`, que les puso los cuatro a los mates), sin virola en la tienda, el
  carrito ni los pedidos (los viejos conservan `ferrule` en el JSON y el mapper la ignora), claves
  de línea `…:{cuero|-}` y relacionados de hasta 30 (misma línea, mismo grupo y el resto).
- **Productos, líneas y firma de fotos** (Task 6, 11 operaciones): `GET/POST /admin/products`,
  `GET/PATCH /admin/products/{id}`, `…/archive`, las 5 de líneas y `POST /admin/media/signature`.
  Migración `20261104184548_b6_admin_catalog` (`product_images.alt` y `categories.image_alt`: el
  texto alternativo es por uso). Stock disponible, `expectedUpdatedAt` al milisegundo, slugs con
  historial bajo un advisory lock, firma simulada o sha1 de Cloudinary y `media_assets` por
  `publicId` sin `P2002`.
- **Resumen** (Task 7, 1 operación): módulo `dashboard` con `PrismaDashboardReader` (solo lectura,
  3 consultas), ventas por `paid_at` en hora de Buenos Aires, poco stock con lo disponible y
  alertas de pago. Vence los pedidos atrasados antes de leer.
- **Menores de las revisiones** (`3983e8d`, `d5af43c`): `@SkipThrottle()` en todos los
  controladores del dashboard (con un test que los recorre); la trampa de `POST /withdrawals` ya no
  consume la secuencia (`peekWithdrawalNumber`); `isHoneypotFilled` en `src/shared/domain`;
  `moderatedAt` se decide dentro de la transacción con la fila bloqueada; un producto que no es
  mate con cueros guardados se lee sin cueros (antes, 500); `resolveImage` rechaza segmentos `.` o
  `..` (también con `%2e`), barras dobles o invertidas y caracteres de control.
- **Seed y cierre** (Task 8):
  - `import-fixtures.mjs` copia `leathers` (obligatorio) y `seed-data` se regeneró desde
    `../frontend-ajustes`: el diff fue solo `leathers` en `products.ts` (16 mates con los cuatro,
    11 sin) y, en `content.ts`, "Categorías", "Los más vendidos" y dos textos que ya no nombran la
    virola. Ningún precio, slug, stock, foto, producto ni combo cambió.
  - Productos con `upsert` por `sequence`: uno renombrado desde el dashboard vuelve al slug del
    diseño sin duplicarse, su slug pasa al historial y el del diseño sale de ahí. Contenidos,
    ajustes y envíos solo se crean si faltan.
  - Este apartado, el ADR 0007 y el README (sección "Dashboard", contrato 83 de 83, seed, fotos,
    tests).

### Decisiones

Rulings de la planificación (B-69 a B-85):

- **B-69 · Alcance:** todo lo que faltaba, 83 de 83. Contrato del `main` del front hasta la ola de
  cueros; después, `CONTRACT_PATH="../frontend-ajustes/docs/api/openapi.yaml"`.
- **B-70 · Cueros:** el contrato nuevo del front, sin ventana de transición (una pestaña vieja de
  la tienda recibe 422 hasta recargar); solo los mates; los pedidos viejos conservan la virola en
  el JSON.
- **B-71 · Stock:** el del dashboard es el disponible; guardar escribe `on_hand = stock + reserved`.
- **B-72 · Caché:** claves con versión; el dashboard lee Postgres sin caché.
- **B-73 · Aviso:** `storefront.stale { tags, reason }` en la misma transacción, con las etiquetas de
  la tabla del README.
- **B-74 · Fotos:** `MEDIA_MODE`, carpeta por uso, `url` armada con la nube, ninguna llamada a la
  Admin API.
- **B-75 · Pedidos:** literal del mock; cancelar con la opción (a) (el adaptador de `orders` cierra
  el intento activo) y el handler de `payments` para la pasarela.
- **B-76 · `support`:** contacto y arrepentimiento en `contact_messages`; los mails en B7.
- **B-77 · Moderación:** sube la versión de la caché y avisa a la tienda.
- **B-78 · Resumen:** módulo `dashboard` de solo lectura; `duplicate_payment` para toda devolución
  que no se aprobó (es la única alerta de devoluciones del contrato).
- **B-79 · Contenidos y ajustes:** último guardado gana; IVA redondeado a 2 decimales; el `label` de
  los envíos se acepta y se descarta.
- **B-80 · Validación:** 422 antes que 404 con un cuerpo inválido; los errores de raíz los da el
  pipe.
- **B-81 · Productos:** 409 `product_changed` antes que los 422 de la base y que el slug; slugs
  contra los actuales y el historial; `publishedAt` en la primera publicación; cambiar el grupo de
  una línea con productos da 422 (desvío del mock: protege combos y cueros).
- **B-82 · Seed:** productos por `sequence`; contenidos, ajustes y envíos solo se crean.
- **B-83 · Pospuesto:** `audit_logs` (B8), pedidos de demostración en el seed (no hacen falta) y
  mails (B7).
- **B-84 · Olas** y **B-85 · relacionados de hasta 30** (con la ola de cueros).

Desvíos de las tareas (todos en sus reportes):

- `expectedUpdatedAt` se compara leyendo el producto con `FOR UPDATE` en la transacción, en vez de
  un `UPDATE … WHERE updated_at = …` (equivalente).
- `POST /withdrawals` con la trampa llena devuelve el número que seguiría sin consumirlo (como el
  mock); con la secuencia agotada la trampa no da 500.
- Algunas specs de casos de uso de las Tasks 1 y 4 se escribieron junto con el código, sin ver el
  RED antes.
- Las Tasks 6 y 7 no corrieron las suites globales; la primera corrida completa de B6 fue la del
  cierre (abajo), en verde.
- **Task 8:** la prueba en vivo usó el back en el **3021**: el 3001 lo tenía tomado el `next` de
  otro proyecto de Lucas (Kora), que no se tocó. La tienda y el dashboard se compilaron contra ese
  puerto.

### Versiones reales instaladas

B6 no instaló nada. Para la prueba en vivo se usó lo del worktree del front: Next.js 16.4.2, Vite
8.3.4 y Playwright 1.64.1 (Chromium headless). Docker Engine 28.4.0.

### Verificación

- **Suite completa en verde** (Task 8, sobre `d8541ca`, la primera corrida completa de B6):
  - `npm run typecheck`, `npm run lint` (versiones y fronteras) y `npm run format:check`.
  - `npm test`: 110 archivos, 1259 tests.
  - `CONTRACT_PATH="../frontend-ajustes/docs/api/openapi.yaml" npm run test:e2e`: 26 archivos y 1
    omitido (el del sandbox), 734 tests y 4 omitidos (309 s).
  - `npm run contract:check`, con ese `CONTRACT_PATH` y sin él (el `main` local del front es el
    mismo commit): 3 archivos, 454 tests y 1 omitido. **83 operaciones implementadas de 83, 0
    pendientes**, sin diferencias.
- **Review Focus del plan, cubierto con E2E:**
  1. **Stock disponible:** el Coquito (`on_hand` 2) con un pedido que reserva 2 da `stock` 0, sale
     en `?stock=out` y en el resumen con 0; un `PATCH` con `stock` 5 deja `on_hand` 7 y `reserved` 2
     (`admin-catalog`, `admin-dashboard`).
  2. **Guardar y verlo al instante:** con la ficha cacheada, cambiar nombre y slug manda un solo
     aviso con las 5 etiquetas y el `GET` por el slug nuevo trae el nombre nuevo; un 422, 403 o 409
     no avisa (`admin-catalog`).
  3. **Cancelar:** con el intento `none`, 200, `paymentStatus: cancelled`, reserva liberada,
     `cancelled_at`, historial `admin`, `order.cancelled` y `storefront.stale`; con `pending`, 409
     `payment_in_progress` sin tocar nada (`admin-orders`).
  4. **Cueros de punta a punta** (`orders`, "cueros por producto").
  5. **La moderación llega a los listados:** aprobar una reseña del Imperial Premium cacheado da
     `rating.count` 4 y la tienda falsa recibe las 4 etiquetas (`admin-reviews`).
- **Seed** (TDD): RED con dos casos nuevos en `seed.e2e-spec.ts` (renombrar un producto y volver a
  sembrar fallaba con `P2002` en `products_sequence_key`; un contenido, un ajuste y un envío
  editados se pisaban) y GREEN con 13 de 13.
- **Prueba en vivo con la tienda y el dashboard (Task 8):**
  - Back compilado (`node dist/main`) en el **3021** con `MP_MODE=simulated`,
    `MEDIA_MODE=simulated`, `STORE_ORIGIN=http://localhost:4320`,
    `ADMIN_ORIGIN=http://localhost:5320` y `STORE_REVALIDATE_SECRET` igual al `REVALIDATE_SECRET`
    de la tienda (64 hex inventados, en un archivo fuera del repo), sobre el Postgres y el Redis de
    compose, migrado y sembrado con el seed nuevo.
  - Tienda (`next start --port 4320`) y dashboard (`vite preview --port 5320 --strictPort`)
    compilados en modo `live` desde `../frontend-ajustes` (`24b62ab`), con el entorno en la misma
    línea y sin `.env.local`.
  - Script de Playwright `live-b6.mjs` en el workspace; capturas `b6-01…26` en
    `.superpowers/sdd/2026-11-04-b6-admin/captures/` (git ignora esa carpeta):
    - **Cueros y stock** (lo que pidió Lucas): antes, las fichas del Imperial Criollo, el Imperial
      Térmico y el Ranchero Manchas Blancas con los cuatro cueros y compra (`b6-01…03`). En el
      dashboard: el Criollo con `[Negro, Crudo]` y stock 0 (`b6-04`), el Térmico solo con Crudo y
      el Ranchero sin cueros (`b6-05`); los tres `PATCH` 200 y tres `storefront.stale`
      `product.updated` con `products`, `product:{slug}`, `categories` y `combos`, publicados y
      regenerados por la tienda a medida que se guardaban (uno cada 2 s). Después (`b6-07…10`): el Criollo con dos muestras (Negro y
      Crudo), "Sin stock por ahora" y "Consultar por mail" en lugar de "Agregar al carrito" y
      "Comprar ahora"; el Térmico con una sola muestra (Crudo); el Ranchero sin selector; en el
      listado de Imperiales, el Criollo con "Sin stock" y el botón de agregar deshabilitado. Por
      API, el back también lo rechaza: la cotización del Criollo da `sold_out`, el Térmico con
      Negro da 422 "Ese cuero no está disponible para este mate." y sin `options` 422 "Elegí el
      cuero del mate.".
    - **Título del inicio:** "Seis líneas para cada ronda" (`b6-11`) → en Contenido → Inicio,
      "Categorías" (y "Los más vendidos" en los destacados) → `PUT` 200 (`b6-12`) → el inicio lo
      mostró a los 3,5 s (`b6-13`).
    - **Reseña:** enviada desde la ficha del Imperial Premium (`POST` 202 `pending`, `b6-14`),
      pendiente en el dashboard (`b6-15`), Aprobar (`b6-16`) → la ficha la mostró a los 2,3 s, con
      4 aprobadas (`b6-17`).
    - **Contacto:** enviado desde Contacto (`POST /contact` 202, `b6-18`) → en Mensajes "Sin leer";
      al abrirlo queda leído (`b6-19`).
    - **Compra** `GLP-10020`: el Ranchero sin cueros (línea con `options: null` y `detail` vacío),
      retiro, Mercado Pago (`b6-20`) → simulador → Aprobar → confirmado (`b6-21`) → en el
      dashboard, pagado (`b6-22`) → "Pasar a preparación" → "Marcar como despachado" con Andreani y
      seguimiento (`b6-23`). Historial: `pending_payment` (cliente), `paid` (pasarela),
      `preparing` y `shipped` (admin).
    - **Cancelación** `GLP-10021`: el Térmico con Crudo (`detail` "Cuero crudo"), sin pagar
      (inventario 12/0 → 12/1) → "Cancelar pedido" con confirmación (`b6-24`, `b6-25`) →
      `cancelled`, `cancelled_at`, reserva `released`, inventario 12/0, historial
      `pending_payment → cancelled` (admin), `order.cancelled` y el aviso `products`, `combos`. El
      pedido no tenía intento de pago (no se llegó a "Pagar"), así que `payment_status` quedó en
      `none`, como dice el contrato.
    - **Resumen** (`b6-26`): ventas de hoy $31.999, poco stock con el Criollo y la Galleta sin
      stock y el Coquito con 2, mensajes sin leer y sin alertas de pago.
  - **Bug de la tienda encontrado (no del back):** después del aviso de los tres productos, la
    tienda respondió **500** en `/producto/[slug]` y `/tienda/[linea]` (`b6-06`, página en
    blanco), con "Route "/producto/[slug]": Next.js encountered uncached or runtime data during
    prerendering" (`NEXT_STATIC_GEN_BAILOUT`) en su log, hasta reiniciar `next start`. El inicio,
    `/kit`, `/contacto` y `/nosotros` siguieron en 200. Reproducido sin el back, reiniciando la
    tienda y mandándole a mano una etiqueta por vez a `POST /api/revalidate`: `categories` y
    `settings` la rompen; `products`, `product:{slug}`, `combos`, `content:home`,
    `content:footer`, `reviews:featured` y `reviews:{slug}` no. El back manda esas etiquetas porque
    son del contrato (B-73) y la tienda las acepta. Para seguir, se reinició la tienda y se le
    mandó el mismo aviso sin `categories`; con eso las fichas mostraron lo guardado en el
    dashboard. Los recorridos que siguieron no mandan ni `categories` ni `settings`.
  - **Logs:** ningún `warn` ni `error` en el back; los 4xx fueron los esperados (`GET /me` y
    `/admin/auth/me` sin sesión, las dos cotizaciones con cuero equivocado a propósito y un
    `GET /products/no-existe`). El secreto no aparece en el log del back ni en los de la tienda o el
    dashboard.
  - **Al cierre:** `npm run db:seed` devolvió los tres mates a los cuatro cueros y stock 12. Los
    títulos "Categorías" y "Los más vendidos" quedaron, porque el seed ya no pisa los contenidos.
    `GLP-10020` (despachado), `GLP-10021` (cancelado), la reseña aprobada y dos mensajes de contacto
    (uno sin leer, de una primera corrida que cortó un error del script) quedan en la base de
    compose. No quedan procesos en el 3021, el 4320 ni el 5320, ni contenedores de compose. El
    front sigue sin cambios y sin `.env.local`; los builds del worktree (`apps/store/.next`,
    `apps/admin/dist`) quedan en modo `live`, apuntando al 3021, ignorados por git.

### Commits

| Commit    | Qué                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `f58d65a` | README: conteo de operaciones y reintentos del aviso a la tienda (antes del plan)                    |
| `0bbcba5` | Plan de B6                                                                                           |
| `c9e219e` | Evento `storefront.stale` (Task 2)                                                                   |
| `e53692e` | Aviso genérico, caché del catálogo con versión y aviso de stock de los pedidos (Task 2)              |
| `310ebf6` | Contenidos y ajustes del dashboard (Task 1)                                                          |
| `b940162` | Contacto, arrepentimiento, bandeja, reseñas nuevas y moderación (Task 4)                             |
| `0c47d79` | Pedidos del dashboard con cancelación (Task 3)                                                       |
| `bdbcd9c` | Cueros por producto, sin virola, relacionados de hasta 30 (Task 5)                                   |
| `c506639` | Resumen del dashboard (Task 7)                                                                       |
| `c2cfdc6` | Productos, líneas y firma de fotos del dashboard (Task 6)                                            |
| `3983e8d` | Menores de las revisiones: límites, trampa sin consumir código, fotos, moderación, no-mate con cuero |
| `d5af43c` | `resolveImage` rechaza puntos con `%2e` y caracteres de control                                      |
| `d8541ca` | Seed: cueros y títulos del front, productos por `sequence`, contenidos que no se pisan (Task 8)      |
| (este)    | Esta bitácora, el ADR 0007 y el README (Task 8)                                                      |

**Para que la CI del back pase:** Lucas pushea primero el `main` del front (con los cueros,
`24b62ab`) y después el `main` del back. La CI clona el `main` remoto del front para el contrato.

### Lo que queda para B7 en adelante

**Para el front (antes de producción):**

- El 500 de `/producto/[slug]` y `/tienda/[linea]` después de regenerar `categories` o `settings`
  (arriba). Con el back de B6, cualquier guardado de un producto, de una línea o de los ajustes
  rompe esas páginas hasta reiniciar la tienda.

**Para B7 (mails):**

- Consumir con handlers del despachador del outbox: `order.paid` (confirmación), `order.shipped`
  (con empresa y seguimiento), `order.delivered`, `order.cancelled`, el arrepentimiento (con su
  código `ARR-…`) y el contacto. Hoy `support` solo loguea la intención (`SupportMailLog`) y la
  recuperación de contraseña sigue en el log.

**Para B8 (`audit_logs` y producción):**

- `audit_logs` de cada escritura del dashboard (quién, qué, antes y después). Hoy quedan
  `order_status_history` (`actor: admin`) y `updated_by`/`version` en contenidos y ajustes.
- `MEDIA_MODE=cloudinary` con las tres `CLOUDINARY_*` (obligatorio en `production`) y la
  contraseña del admin semilla.

**Menores aceptados:**

- `catalog:version` sin TTL: si Redis lo desaloja vuelve a 0 y pueden reaparecer claves `v0` viejas
  hasta 60 s.
- Las posiciones de líneas y combos se calculan sin lock (`max + 1`): con un solo admin alcanza.
- El slug anterior del aviso de un producto sale de una lectura previa a la transacción: un rename
  simultáneo podría avisar un slug viejo (ventana de milisegundos).
- Entradas de Redis de antes del deploy (sin `leathers`) se leen hasta que vencen (60 s).
- Una pestaña de la tienda abierta antes del cambio de cueros manda `ferrule` y recibe 422 hasta
  recargar (B-70).

## Seguridad: arreglos de la auditoría (2026-11-14)

Pistas de la auditoría con la skill de Cloudflare (`security-audit-skill/galpon-backend/run-1`,
`NEEDS-VALIDATION.md`). Cada una se releyó en el código, se mostró con un test en rojo y se arregló
en la raíz sin tocar el contrato. Entre paréntesis, el número de `findings.json`.

### Tanda A · cuentas, sesiones y configuración

- **NV-02 (7)** arreglada: el registro nunca adopta al invitado del mismo email (crea su propio
  cliente; los pedidos de invitado siguen por token). Migración: el email de `customers` deja de ser
  único y queda un índice único parcial por invitado (`customers_guest_email_key`). Pendiente del
  front: la tienda todavía promete "tus pedidos aparecen en tu cuenta apenas la creás".
- **NV-10 (18)** arreglada: en producción el seed exige `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios (12
  o más, distinta de la de demostración) y sin `NODE_ENV` no corre.
- **NV-32 (25)** arreglada: cambiar la contraseña del admin cierra sus otras sesiones y renueva la
  actual (mismo CSRF).
- **NV-03 (8)** arreglada: marca de credenciales por usuario; se rechaza toda sesión autenticada
  hasta el cambio, aunque se cree después.
- **NV-24 (31)** arreglada: la marca va primero y el borrado es de mejor esfuerzo, de a 100; ya no da
  503 ni deja sesiones vivas.
- **Candidato sin resolver (sesiones por usuario)** arreglado: tope de 20 sesiones; al abrir la 21 se
  cierra la más vieja.
- **NV-08 (4)** arreglada: el contador sube con `INCR` antes de verificar; de 15 intentos a la vez se
  verifican 10.
- **NV-09 (5)** arreglada: el bloqueo cuenta por email e IP (`req.ip`, la del límite por IP; con
  `trust proxy` de otra tanda pasa a ser la del cliente real).
- **NV-19 (26)** arreglada: la sesión anónima dura 30 minutos (antes 24 h).
- **NV-26 (6)** aceptada: el 409 `email_already_registered` lo fija el contrato.
- **NV-20 (27)** pendiente: se resuelve con el mail de verificación de la ronda de mails (B7).
- **NV-07 (20)** arreglada: sin `NODE_ENV` explícito la API no arranca y el error lo dice.
- **NV-31 (21)** arreglada: variable `HOST`, por defecto `127.0.0.1` fuera de producción y `0.0.0.0`
  en producción.
- **NV-33 (2)** arreglada: `docker-compose.yml` publica Postgres y Redis solo en `127.0.0.1`.

### Tanda B · pagos y pedidos

- **NV-05 (14)** arreglada: el webhook rechaza con 401 un `ts` a más de 5 minutos del reloj (para
  atrás o para adelante; segundos o milisegundos) y deduplica por el manifiesto firmado
  (`id:…;request-id:…;ts:…;`), no por el `id` del cuerpo. Riesgo anotado: si Mercado Pago reintenta
  con el `ts` original, los reintentos de más de 5 minutos dan 401 (queda la conciliación).
- **NV-29 (11)** arreglada: si el despacho de un evento del outbox agota los reintentos de BullMQ
  (o el job queda trabado), vuelve a quedar pendiente con `dispatch_failures` y `available_at` (1, 2,
  4… hasta 60 minutos, 8 vueltas, unas 3 horas); después, error en el log. El relay lo publica con
  `jobId` `<id>-r<vuelta>`. Migración nueva.
- **NV-27 (13)** arreglada: el despachador relee el evento de `outbox_events` por su id y descarta
  (con error en el log) el job que no existe, es de otro tipo o trae otro payload; los handlers
  reciben siempre el evento guardado.
- **NV-06 (15)** arreglada: `cancel-payment` y el consumidor de `order.expired` cancelan con
  `PaymentRepository.cancelActive` (con el intento bloqueado, solo si sigue activo): una aprobación
  que llegó en el medio ya no retrocede a `cancelled` ni se cancela en Mercado Pago.
- **NV-04 (12)** arreglada: `ApplyProviderPaymentCommand` (y `refundApproved`) corren con el pedido
  bloqueado (`serializeByOrder`, `pg_advisory_xact_lock` en una transacción abierta); la mitad B de
  un pago dividido ya no se devuelve como duplicada y dos pagos sobre la misma preferencia no se
  pisan. Riesgo anotado: la transacción del bloqueo ocupa una conexión del pool (10) mientras el
  trabajo usa otra; con 10 aplicaciones a la vez esperarían hasta el plazo de 60 s.
- **NV-01 (3)** arreglada: pino tapa `Idempotency-Key` (pino-http escribía la cabecera con la URL).
- **NV-15 (10)** arreglada en lo que se puede: el campo trampa ya no gastaba número; ahora una
  dirección con U+0000 o mitades sueltas de un par sustituto (Postgres no los guarda y el pedido daba
  500 después de `nextval`) responde 422 (los saltos de línea y demás caracteres de control se
  guardan bien y se siguen aceptando), y el tope de NV-14 corre antes de la
  secuencia. El contrato fija `^GLP-[0-9]{5}$`: el límite (89.999 pedidos) y su margen quedan en el
  README.
- **NV-12 (33)** arreglada: el comentario del arrepentimiento con esos caracteres responde 422 (antes
  500 con el código gastado) y el máximo de `withdrawal_code_seq` pasa a 12 dígitos (el contrato no
  fija el formato): después de `ARR-999999` sigue `ARR-1000000`. Migración nueva (secuencia y CHECK).
- **NV-14 (9)** arreglada: como mucho 3 pedidos `pending_payment` a la vez por cliente (el email del
  checkout y, con sesión, el cliente); el cuarto responde 429 `rate_limited` (declarado en
  `POST /orders`) con `Retry-After` hasta que vence la reserva del más viejo, sin reservar stock ni
  gastar número. Se controla en la transacción, con bloqueo consultivo. No se cuenta por sesión
  anónima: una sesión nueva cuesta un `GET /auth/csrf`, así que no acota más que el email. Riesgo
  anotado: quien cambia de email en cada pedido no queda acotado por esto (siguen el límite por IP y
  el stock).
- **NV-28 (17)** arreglada: columna `orders.payment_reconciled_at`; la conciliación toma primero los
  que nunca pasaron y después los que hace más que no pasan, y anota cada pedido (bien o mal).
- **NV-16 (16)** arreglada: tope de 10 intentos de pago por pedido (contados con el pedido bloqueado
  en `startAttempt`); el siguiente responde 409 `order_not_payable` (declarado en las rutas de pago;
  la tienda descarta el pedido y la persona arma otro) sin llamar a Mercado Pago. Las cuotas
  (`installments`) no crean intentos y siguen sin límite propio (piden el `X-Order-Token` del
  pedido): riesgo aceptado en esta tanda, queda anotado para la de límites.

### Tanda C · límites y recursos

- **NV-25 (32)** arreglada: variable `TRUST_PROXY` (IPs, redes CIDR o `loopback`, `linklocal`,
  `uniquelocal`; apagada por defecto). Con ella Express toma la IP del cliente de `X-Forwarded-For`
  saltando solo esos proxies, y los límites por IP (y el bloqueo de login de NV-09) cuentan por
  cliente. La tienda todavía no manda la IP real: el rewrite de Next 16 reenvía la cabecera que le
  llega (sin agregar la del navegador) y su servidor no la pone. Hace falta un proxy delante de la
  tienda que la escriba (README, "Puertos y orígenes").
- **NV-17 (22)** arreglada: la app se crea sin los body parsers de Nest (`APP_OPTIONS`). JSON de hasta
  100 kB y sin descomprimir (`Content-Encoding` da 415); formularios solo con el simulador de pagos
  (nunca en producción), planos, de 8 kB y 10 campos. Los 413 y 415 salen con el texto en español.
- **NV-13 (1)** arreglada: el listado de productos se cachea solo sin `q` ni `ids`, con `pageSize` 24
  o 100, y nunca una página vacía: las claves dependen del catálogo y no de lo que mande el cliente.
- **NV-18 (23)** arreglada con condición: `@PublicRead()` en las 14 lecturas públicas, 300 por
  minuto por IP real. No cuenta sin `TRUST_PROXY` ni los pedidos que origina un proxy de confianza
  (el servidor de la tienda armando sus páginas). Riesgo aceptado: sin `TRUST_PROXY` siguen sin
  límite (con la IP del socket frenaría a toda la tienda). El pool y `statement_timeout` quedan para
  B8.
- **NV-22 (29)** arreglada: las reseñas aprobadas de un producto y las destacadas pasan por la caché
  (60 s, con la versión del catálogo que sube la moderación); una clave por producto publicado y una
  para las destacadas. Sin cambiar el contrato.
- **NV-23 (30)** arreglada: un 422 trae como mucho 50 errores, y con más de 50 líneas en el carrito
  se convierten y validan solo las primeras 51 (el límite de líneas del contrato).
- **NV-30 (24)** arreglada: como mucho 20 direcciones por cliente. La 21 responde 422
  `validation_error` con el error en `addresses` (`address_book_full`), que el contrato permite y la
  tienda muestra como mensaje general. Conteo y alta van con un bloqueo consultivo por cliente.
- **NV-21 (28)** arreglada en parte: como mucho 5 reseñas por IP real por día (24 h desde la primera;
  la sexta da 429 `rate_limited` con `Retry-After`, sin guardar). Por email no se puede: el
  contrato no pide email en la reseña. Sin `TRUST_PROXY` no se cuenta. La purga de las pendientes
  viejas queda para la ronda de datos personales.
- **NV-11 (19)** arreglada: todo lo que no es lectura pública sale con `Cache-Control: no-store` y
  `Vary: Cookie` (cuenta, admin, pedido por token, pagos y `GET /auth/csrf`).
- Fuera de la tanda: las cuotas (`installments`) siguen sin límite propio (aviso de la tanda B) y el
  `message` del contacto sigue sin pasar por `isStorableText`.

### Verificación independiente de las tandas A, B y C

Cada arreglo se revirtió en una copia (worktree) y su test volvió a rojo por la razón esperada (41
mutaciones: unitarias y, para lo que vive en Prisma o Redis, E2E con Testcontainers).

- **NV-01 (3)** arreglada en la raíz en esta verificación: tapar la clave en pino era un síntoma; la
  repetición idempotente devolvía la preferencia sin `X-Order-Token` (E2E en rojo: 200). Ahora el
  hash incluye el token y sin él (o con otro) responde 422 `idempotency_key_reused`.
- **NV-02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 17, 19, 22, 23, 24, 25, 27, 28, 29, 30, 31 y
  32** arregladas y probadas: el test de cada una falla sin su arreglo. **NV-33** arreglada (solo
  configuración, sin test).
- **NV-14 (9)** arreglada en parte: el tope por email funciona, pero rotando emails solo acotan el
  límite por IP de `POST /orders` (120 por minuto) y el stock.
- **NV-15 (10)** aceptada en lo que queda: cada pedido válido sigue gastando un número y el formato
  `^GLP-[0-9]{5}$` lo fija el contrato; ampliarlo es una decisión del contrato.
- **NV-16 (16)** arreglada en parte: el tope de 10 intentos funciona; las cuotas siguen sin límite y
  todo `PaymentsController` sigue con `@SkipThrottle()`. Pendiente.
- **NV-18 (23) y NV-21 (28)** arregladas con condición: sin `TRUST_PROXY` (y un proxy que escriba
  `X-Forwarded-For`) no cuentan; motivo cierto (con la IP del socket se frenaría a toda la tienda).
- **NV-26 (6)** aceptada: motivo cierto (el 409 está en el contrato). **NV-20 (27)** pendiente (B7).
- Riesgo nuevo anotado: NV-09 cuenta por email e IP, así que quien rota IPs (con IPv6, una red /64
  entera) ya no queda frenado por email.

### Restos de la verificación (2026-11-15)

Las tres decisiones de Lucas sobre lo que la verificación dejó pendiente. Cada punto, con su test en
rojo antes del arreglo (unitario y E2E con Testcontainers).

- **NV-09 (5)** arreglada del todo: el bloqueo de login cuenta por cliente normalizado
  (`clientNetworkOf`: una IPv4 mapeada `::ffff:` es la misma IPv4, también en hexadecimal; una IPv6
  cuenta por su red /64, así estrenar direcciones de la misma red no da intentos nuevos). Además hay
  un tope por email (`login-fail-email:{email}`): 100 intentos verificados en una hora (desde el
  primero) frenan ese email desde cualquier IP con el mismo 429 `rate_limited` y `Retry-After`. Solo
  suma lo que el par email + IP deja verificar, así que desde una sola IP (40 por hora como mucho)
  nadie bloquea al dueño: hacen falta al menos tres redes en la hora. Un inicio de sesión correcto
  borra los dos contadores. Riesgo aceptado: con 100 fallos desde varias redes un anónimo deja al
  admin afuera hasta una hora; el límite por IP del throttler (y el cupo de reseñas) sigue contando
  por dirección, sin agrupar por /64.
- **NV-16 (16)** arreglada del todo: `PaymentsController` ya no lleva `@SkipThrottle()`. Lleva
  `@ClientRateLimit()`, el mecanismo de `@PublicRead()` llevado a `client-rate-limit.ts` (límite por
  IP real del cliente, solo con `TRUST_PROXY`; los pedidos que origina un proxy de confianza no se
  cuentan): 60 por minuto en `installments` y 30 por minuto en cada una de las demás rutas de pago.
  El 429 ya estaba declarado en el contrato. El webhook de Mercado Pago sigue sin límite. Riesgo que
  sigue: sin `TRUST_PROXY` (y un proxy que escriba `X-Forwarded-For`) las cuotas no tienen límite.
- **Textos libres públicos** arreglados: el `message` y el `name` del contacto, el `text` de la
  reseña y la etiqueta (`label`) de la libreta pasan por `isStorableText` (decorador compartido
  `StorableText`, que también usan ya la dirección y el comentario del arrepentimiento): U+0000 o una
  mitad suelta de un par sustituto dan 422 "Ingresá un texto" (`invalid_format`) en vez de 500. El
  email de todos los formularios (contacto, arrepentimiento, registro, inicio de sesión,
  recuperación, checkout y pagador) con una mitad suelta daba 500 porque `isEmail` de validator.js
  lanza `URIError`: ahora da 422 `invalid_email`. Revisados y sin cambios: nombres y apellidos
  (`PersonName`, patrón de letras), teléfono, número de calle, código postal, provincia y documento
  (patrones o listas), contraseñas (no se guardan en texto) y la búsqueda del catálogo (ya devolvía
  vacío con U+0000).

Rojo antes del arreglo: 37 unitarios (24 de textos, 8 de NV-09 y 5 de NV-16) y 9 E2E (500 en
contacto, reseña y libreta; 401 donde iba 429 en la /64, la IPv4 mapeada y el tope por email; 120
verificados donde iban 100 en Redis; 200 y 204 donde iba 429 en cuotas y cancelación). Verificación
final: `typecheck`, `lint` y `format:check` sin errores; `npm test` 118
archivos y 1411 tests; `test:e2e` 27 archivos y 1 salteado, 782 tests y 4 salteados;
`contract:check` 3 archivos, 454 tests y 1 salteado. Sin migraciones ni dependencias nuevas.

## B7 · Mails, datos personales y contrato legal (2026-11-17)

Plan: `docs/superpowers/plans/2026-11-17-b7-mails-datos.md`. Rulings LS-5, LS-6 y LS-10 de la ronda
legal (LS-1, decisiones de Lucas, no se discute). Cuatro tareas: mails (Task 1), datos personales
(Task 2), contrato nuevo del front (Task 3) y cierre (Task 4).

### Mails (Task 1)

- **Puerto único** `MailPort` (`src/shared/application/ports/mail.port.ts`) con dos adaptadores,
  según `MAIL_MODE`: `LogMail` (por defecto; loguea solo la plantilla y `l***@dominio.com`) y
  `SmtpMail` con `nodemailer` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`;
  en producción `smtp` es obligatorio y falta una variable, la API no arranca). Puerto 465 con TLS
  directo; cualquier otro, STARTTLS obligatorio salvo en `localhost`.
- **Módulo `notifications`:** diez plantillas puras en español (texto + HTML simple, sin imágenes
  remotas ni rastreo, sin newsletter), la cola BullMQ `mails` (5 intentos con backoff exponencial;
  `jobId` = id del evento + plantilla, así un evento repetido no manda dos mails) y un handler del
  outbox que solo encola. El mail lee los datos al salir: los eventos llevan solo ids.
- **Eventos nuevos** en la misma transacción que la escritura: `withdrawal.requested`,
  `contact.received` y `customer.registered`.
- **Directos a la cola** (sin pasar por Postgres): `password-reset` (el enlace con el token) y
  `account-deleted` (el email ya no existe cuando sale). Se borran al completarse y, si agotan los
  intentos, a las 24 h.
- `nodemailer` **10.3.1** exacta (la más nueva con 14 días publicada al fijarla).

### Contrato legal del front (Task 3)

- Documentos legales `terms`, `privacy`, `cookies` y `returns`, con los ocho marcadores de los datos
  del vendedor (un `{{dato}}` desconocido da 422) y los textos de fábrica de las fixtures del front.
- Ajustes: `consumerLinks` (Ley CABA 2244 y Ventanilla Federal Única) con los enlaces de fábrica, y
  Data Fiscal acepta el código de ARCA y guarda solo el enlace. El pie ya no tiene
  `consumerDefenseUrl`.
- **`DELETE /me`:** con la contraseña actual borra usuario, cliente, direcciones, tokens y reseñas
  pendientes, cierra las sesiones y manda `account-deleted`; los pedidos quedan sin vínculo (tabla
  completa en el ADR 0008, punto 5). Contrato: 84 de 84 operaciones implementadas.
- Migración `20261117130000_b7_contrato_legal` (columna `settings.consumer_links`).

### Datos personales: purga, columnas sin uso y logs (Task 2)

Decisión en [ADR 0008](adr/0008-datos-personales.md) (Ruling LS-5).

- **Plazos** en `RETENTION` (`src/modules/privacy/domain/retention.ts`): claves de idempotencia
  48 h desde que se crean; tokens de contraseña 7 días después de vencer; mensajes de contacto 24
  meses; eventos de webhook procesados y del outbox publicados 90 días; reseñas pendientes u
  ocultas 12 meses; pedidos y arrepentimientos 10 años (no se purgan en esta pieza). Las reseñas
  aprobadas nunca.
- **Purga:** módulo `privacy` con `PurgeExpiredDataCommand.execute(now) → PurgeSummary` (una
  cantidad por tipo), `ExpiredDataRepository.deleteBatch(target, cutoff, limit)` (Prisma, lotes de
  500 por `ctid`) y `PrivacyPurgeSweep` (a los 5 min de arrancar y cada 24 h; loguea solo
  cantidades; en test no arranca).
- **Migración** `20261117120000_b7_datos_personales`: fuera `customers.document_type` y
  `customers.document_number` (sin uso en código, seed ni tests).
- **Logs:** `serializeRequest` deja la ruta sin la query y solo los nombres de sus parámetros
  (`GET /admin/orders?q=juan@mail.com` → `"url":"/api/v1/admin/orders","query":["q"]`).
- **Tests:** `retention.spec.ts`, `purge-expired-data.command.spec.ts` (Review Focus 4 con dobles),
  `privacy-purge.sweep.spec.ts`, `logger.module.spec.ts` (Review Focus 5, con `pino-http` real) y
  `test/e2e/privacy.e2e-spec.ts` (filas fechadas a mano en Postgres y columnas borradas).

### Verificación (Task 4)

Contra el contrato de la rama `feat/legal-accesibilidad` del front
(`CONTRACT_PATH="C:/Users/lucas/.galpon-trabajo/frontend-legal/docs/api/openapi.yaml"`):
`typecheck`, `lint` y `format:check` sin errores; `npm test` 128 archivos y 1481 tests;
`test:e2e` 30 archivos y 1 salteado (el sandbox de Mercado Pago), 810 tests y 4 salteados;
`contract:check` 3 archivos, 466 tests y 1 salteado (84 de 84 operaciones, 0 diferencias).

**Prueba en vivo con un servidor de mails falso.** Back compilado (`node dist/main`) en el 3021 con
`MAIL_MODE=smtp` contra un servidor SMTP falso local (un script con `node:net` en 127.0.0.1 que
guarda cada mensaje; nada salió a internet), `MP_MODE=simulated`, y Postgres y Redis de un
`docker compose -p galpon-livecheck` aparte (volúmenes propios, borrados al terminar: la base de
desarrollo de Lucas no se tocó), migrado y sembrado. Con curl: pedido de invitado, pago con la
tarjeta simulada `APRO`, preparando y despachado desde el admin, arrepentimiento, contacto,
registro, olvidé mi contraseña y eliminar la cuenta. Llegaron los ocho mails esperados:

| Mail               | Asunto                                    | Destinatario                 |
| ------------------ | ----------------------------------------- | ---------------------------- |
| `order-received`   | Recibimos tu pedido GLP-10001             | El del pedido                |
| `payment-approved` | Aprobamos el pago de tu pedido GLP-10001  | El del pedido                |
| `order-shipped`    | Despachamos tu pedido GLP-10001           | El del pedido                |
| `withdrawal-code`  | Recibimos tu arrepentimiento (ARR-000001) | El de la solicitud           |
| `contact-received` | Recibimos tu mensaje                      | El del mensaje               |
| `password-reset`   | Cambiá tu contraseña de Galpón Mates      | El de la cuenta              |
| `account-created`  | Tu cuenta en Galpón Mates está lista      | El de la cuenta              |
| `account-deleted`  | Eliminamos tu cuenta de Galpón Mates      | El de la cuenta (ya borrada) |

Cada mail tuvo un solo destinatario, el mismo en el sobre SMTP y en la cabecera; ninguno llevó
imágenes; el texto trae el resumen, el total, el arrepentimiento de 10 días y los enlaces a
`STORE_ORIGIN`; el log del back no mostró ningún email ni el token de restablecer. Un primer
`POST /orders` con un nombre mal codificado por la terminal dio 422 y no gastó número (el pedido
fue el `GLP-10001`). No apareció ningún bug del back. Al terminar se bajaron el back, el servidor
falso y los contenedores.

### Commits

- `b4e1a5d` docs(plan): B7 con las tareas del contrato legal y el cierre
- `13ac87e` feat(notifications): mails de pedidos, pagos, envíos, arrepentimiento, contacto y
  cuenta por SMTP
- `5563f5f` feat(privacy): purga diaria con plazos de conservación, columnas sin uso y logs sin
  datos de más
- `f117117`, `035feae` y `7d46b88` fix(notifications): menores de la revisión (jobs directos
  fallidos, versión de `nodemailer`, nota del ADR)
- `7cf27fa` feat(legal): documentos de cookies y devoluciones, enlaces de consumidor y eliminar la
  cuenta
- docs: bitácora de B7, lanzamiento legal y README (este cierre)

### Cierre con el front en `main` (2026-11-17)

La rama `feat/legal-accesibilidad` del front ya está unida a su `main` (`c2a11fe`), junto con los
arreglos de seguridad del front. Desde ahí no hace falta `CONTRACT_PATH`: `npm run contract:check`
lee `../frontend` y da 3 archivos, 466 tests y 1 salteado, con 0 de 84 operaciones pendientes, y
`node scripts/import-fixtures.mjs` contra `../frontend` no cambia el seed.

Después del cierre de la Task 4 se sumaron `ef4c877` (el aviso de la baja se encola antes de cerrar
las sesiones, con su test) y `50088e2` (los comandos de `LANZAMIENTO-LEGAL.md` en bloques de
código). Con ellos, `npm test` da 128 archivos y 1482 tests y
`test/e2e/account-deletion.e2e-spec.ts`, 4 de 4.

### Lo que queda después de B7

- **Lucas:** correr `npm run db:migrate` (dos migraciones de B7) y completar
  [`docs/LANZAMIENTO-LEGAL.md`](LANZAMIENTO-LEGAL.md) con el dueño, el abogado y el contador
  (datos del vendedor, cuenta SMTP y sus variables, `TRUST_PROXY`, Cloudinary, Registro Nacional de
  Bases de Datos, revisión de los cuatro textos y lo demás).
- **Seguridad pendiente:** la verificación del email de las cuentas (NV-20: necesita un cambio de
  contrato con el front) y el formato del número de pedido (NV-15: `GLP-` y cinco dígitos).
- **Menor aceptado de la revisión:** si Redis falla durante `DELETE /me`, la cuenta ya quedó borrada
  pero la respuesta es 503 sin borrar la cookie. El aviso por mail ya no se pierde: desde `ef4c877`
  se encola apenas se borra la cuenta, antes de cerrar las sesiones.
- **B8:** `audit_logs` del dashboard y la configuración de producción.

## B8 · Producción (2026-11-17)

Plan: [`superpowers/plans/2026-11-17-b8-produccion.md`](superpowers/plans/2026-11-17-b8-produccion.md).
Guía para Lucas: [`DESPLIEGUE.md`](DESPLIEGUE.md) (Vercel y Render). Con esta pieza quedan hechas
las ocho del diseño (§11).

### Lo que decidió Lucas

Hubo un cambio el mismo día. Primero se planeó y se construyó un VPS con Docker (Caddy, Postgres y
Redis en el mismo servidor). Después Lucas escribió que **el front va a Vercel y el back a
Render**, y esa es la decisión que vale: el dashboard también en Vercel, Postgres y Redis en
Render, primero en los planes gratis para probar y sin dominio propio por ahora. Lo del VPS quedó
hecho y probado como **camino alternativo** ([`DESPLIEGUE-SERVIDOR-PROPIO.md`](DESPLIEGUE-SERVIDOR-PROPIO.md)
y `deploy/`).

### Qué se hizo

- **`audit_logs` del dashboard** (módulo `audit`, migración `20261117223806_b8_audit_logs`): un
  interceptor global anota cada escritura exitosa de `/admin/*` (quién, `action`, entidad y
  `changes` con lo que se mandó y solo las columnas que cambiaron). Sin cambio de contrato. El
  detalle está en "Auditoría del dashboard" del README.
- **Configuración de producción:** `STORE_ORIGIN` y `ADMIN_ORIGIN` obligatorias con
  `NODE_ENV=production`; `STORE_INTERNAL_ORIGIN` (el aviso a la tienda por una red interna); el pool
  de Postgres con `connectionTimeoutMillis` (10 s) y `statement_timeout` (30 s).
- **La IP real con un secreto compartido** (`TRUSTED_PROXY_SECRET`,
  `src/shared/infrastructure/http/trusted-proxy.ts`): un pedido que trae el secreto en
  `x-galpon-proxy-secret` viene de los proyectos de Vercel, y la IP del cliente es la de
  `x-galpon-client-ip` (la tienda) o, con `x-galpon-client-ip-from: x-forwarded-for`, la primera de
  `X-Forwarded-For` (el dashboard). Sin el secreto, el pedido cuenta por la IP con la que llega.
- **Seed sin consola:** `prisma/seed.ts --if-empty` siembra solo una base sin productos ni admin.
  La imagen lleva el seed y `admin:password` compilados (`dist-scripts`) y, con
  `SEED_IF_EMPTY=true`, corre el seed así en cada arranque, después de las migraciones.
- **`npm run admin:password`:** crea el admin o le cambia la contraseña sin tocar el catálogo. En
  producción el seed se corre una sola vez (una segunda corrida pisa líneas, productos, reseñas y
  combos del diseño), así que hacía falta otra forma de recuperar el acceso.
- **Render:** `render.yaml` (Blueprint) con el back desde el `Dockerfile`, Postgres 17 y Key Value,
  en la región Virginia.
- **Camino alternativo con Docker** (`deploy/`): compose con `caddy`, `store`, `admin`, `api`,
  `postgres`, `redis` y `backup`; `Caddyfile`; `.env.example`; copia diaria con `pg_dump`; y un
  compose para ensayar en la compu.
- **Front** (sus commits, en su repo): el secreto en el proxy y en las lecturas del servidor de la
  tienda, `apps/admin/vercel.json` (cabeceras, SPA y reenvío de `/api/v1/admin/*` al back), el tope
  de la caché de páginas en disco (pista 13, solo fuera de Vercel) y las imágenes de Docker.

### Decisiones y desvíos

- **B-90 · `TRUST_PROXY` no alcanza en Vercel y Render.** Confía por dirección IP, y las de salida
  de Vercel no son fijas; Render además no documenta su cadena de `X-Forwarded-For`. Por eso el
  secreto compartido. Los dos mecanismos conviven y están pensados como alternativas. Un pedido sin
  secreto cuenta por la IP del socket: quien saltea la tienda comparte un solo cupo y no les saca
  lugar a los visitantes.
- **B-91 · `x-galpon-client-ip-from` gana sobre `x-galpon-client-ip`.** El reenvío del dashboard en
  Vercel no tiene código (es una regla de `vercel.json`): agrega el secreto, pero no se puede
  confiar en que borre una cabecera que mande el visitante. Con `-from` la IP sale siempre de lo
  que escribe Vercel.
- **B-92 · El dashboard habla con el back por su propio origen.** Un dashboard en `vercel.app` y un
  back en `onrender.com` son sitios distintos y la cookie `__Host-` con `SameSite=Lax` no viaja. El
  proyecto del dashboard reenvía `/api/v1/admin/*` desde Vercel. No se aflojó la cookie
  (`SameSite=None` abriría la puerta a CSRF y los navegadores bloquean cookies de terceros).
- **B-93 · Migraciones y seed al arrancar, sin comando previo al despliegue.** El plan gratis de
  Render no tiene consola, ni trabajos sueltos, ni comando previo. Con el arranque de la imagen
  alcanza para los dos planes. El seed automático solo corre con la base vacía.
- **B-94 · En el camino alternativo, la tienda se compila al arrancar su contenedor**, no al
  construir la imagen: `next build` lee el catálogo del back y deja fijos el rewrite, la CSP y las
  `NEXT_PUBLIC_*`. Ahí el aviso a la tienda va por la red interna
  (`STORE_INTERNAL_ORIGIN=http://store:3000`) y Caddy responde 404 a `/api/revalidate` desde
  internet.
- **B-95 · Swagger sigue sin montarse en producción.** El diseño (§7) decía "protegido por sesión
  de admin"; no montarlo es más estricto y no se necesita en el servidor.
- **B-96 · La auditoría va en un interceptor**, no en cada comando: los comandos no reciben al
  actor y así no se acopla ningún módulo. No es atómica con la escritura (se guarda después, antes
  de responder): si falla, queda el error en el log y la escritura no se revierte. `changes` no
  copia datos de clientes (de pedidos, reseñas y mensajes, solo las columnas que cambian), por eso
  `audit_logs` no entra en la purga del ADR 0008.
- **Un error que apareció al probar la imagen:** `prisma generate` corría sin el `tsconfig.json` al
  lado y escribía los imports del cliente con `.ts`; el back compilado no arrancaba
  (`Cannot find module './internal/class.ts'`). El `Dockerfile` copia los `tsconfig` antes de
  instalar y carga el cliente compilado al construir (`72c6efc`).

### Verificación

**Simulación del camino de Render y Vercel en esta máquina** (la imagen de producción con las
variables de `render.yaml`, credenciales falsas, en el 3021; la tienda compilada en vivo con Next
16.4.5 en el 4410):

- Con un tope de 512 MB de memoria (el plan pago más chico de Render) arrancó, sembró y atendió
  usando unos 160 MB.
- La imagen se construye y corre como el usuario `node`. En el primer arranque aplicó las 15
  migraciones y sembró ("Seed listo: 6 categorías, 27 productos…"); al reiniciar, "No pending
  migrations" y "Seed salteado (--if-empty)". Escucha en `PORT=10000`.
- La tienda compiló en vivo contra ese back al primer intento y ninguna de sus lecturas dio 429.
- Por la tienda, el ingreso llegó a 429 en el intento 21 para un cliente (`X-Real-IP`) y otro
  siguió pasando; el primero no salió del 429 inventando `X-Forwarded-For`, `x-galpon-client-ip`,
  `x-galpon-client-ip-from` ni el secreto.
- Directo al back y sin secreto, 21 pedidos con 21 IP inventadas compartieron un cupo (429 en el 21) y el cliente que entra por la tienda no se vio afectado.
- Como llega desde el dashboard (secreto, `-from` y la IP a la izquierda de `X-Forwarded-For`): el
  admin sembrado entró, un visitante con contraseña mala llegó a 429 en el intento 21 y otro siguió
  entrando.
- En los logs del back no aparece ni la cabecera ni el valor del secreto.
- `render.yaml` valida contra el esquema oficial de Render
  (`https://render.com/schema/render.yaml.json`).

**Ensayo del compose del camino alternativo** (modo producción, back en el 3021, tienda en el 4410
y dashboard en el 5410; después se desarmó con `down -v`): los seis contenedores `healthy`; seed
con el perfil `tools`; la tienda compiló dentro de su contenedor (27 s) y no recompiló al
reiniciar; el dashboard con su CSP; un `PATCH` de una línea dejó su fila en `audit_logs` y el log
dijo "La tienda regeneró categories, products"; límites por IP real con `X-Real-IP`; la copia
diaria se hizo y se restauró; `npm run admin:password` cambió la contraseña; `caddy validate`
aceptó el `Caddyfile`.

**Suites** del back, sobre `d28733b` más la documentación: `typecheck`, `lint` y `format:check`
en verde; `npm test`, 135 archivos y 1661 tests; `npm run test:e2e`, 33 archivos (1 salteado) y
834 tests (4 salteados); `npm run contract:check`, 466 tests (1 salteado) y 0 de 84 operaciones
pendientes. En el front, sobre Next 16.4.5: `typecheck`, `lint`, `format:check` y
`api:check` en verde; `npm test`, 337 archivos y 4713 tests; E2E con 2 procesos, 501 pasan, 119 salteadas a propósito y 0 fallan (una corrida anterior tuvo
una falla inestable en la captura del diálogo de sesión vencida, `e2e/admin/visual.spec.ts:82`,
que repetida sola pasó 10 de 10).
`npm audit --omit=dev` del back: 0 vulnerabilidades.

### Lo que no se pudo comprobar sin las cuentas reales

- Que el Blueprint se cree sin errores en la cuenta de Lucas y con la dirección esperada.
- Que Vercel compile los dos proyectos desde el monorepo.
- El reenvío de `apps/admin/vercel.json` (está escrito según la documentación de Vercel, pero solo
  se prueba desplegado) y que la IP real llegue al back a través de Vercel.
- Mercado Pago, el SMTP y Cloudinary con credenciales reales.
- En el camino alternativo: el certificado HTTPS de Caddy y el DNS.

### Commits

- `f4aadbd` feat(audit): `audit_logs` de las escrituras del dashboard
- `f00d5ea` feat(config): orígenes explícitos en producción, aviso interno a la tienda y topes del
  pool
- `bc0323a` feat(seed): `npm run admin:password`
- `e3e5847` feat(deploy): imagen del back y compose de producción
- `72c6efc` fix(deploy): el cliente de Prisma se genera con el `tsconfig` al lado
- `519ec34` feat(http): IP del cliente autenticada con un secreto compartido
- `d28733b` feat(seed): siembra con `--if-empty` al arrancar y scripts compilados para la imagen
- feat(deploy): `render.yaml`; docs: plan, las dos guías, lanzamiento legal, README y esta
  bitácora (este cierre)
- En el front: el tope de la caché de páginas, las imágenes de Docker, el secreto del proxy,
  `apps/admin/vercel.json` y su documentación, sobre Next 16.4.5.

### Lo que queda después de B8

- **Lucas:** seguir [`DESPLIEGUE.md`](DESPLIEGUE.md) (cuentas, Render, los dos proyectos de Vercel,
  Mercado Pago y su webhook, SMTP y Cloudinary) y completar
  [`LANZAMIENTO-LEGAL.md`](LANZAMIENTO-LEGAL.md). En su compu: `npm install` en `frontend` (cambió
  Next) y `npm run db:migrate` en `backend` (suma la migración de `audit_logs`).
- **Fuera de B8, anotado:** que el interceptor de idempotencia espere al pedido en curso en vez de
  responder 409, y los límites por sesión (cambian el comportamiento del checkout: van en una pieza
  propia); la verificación del email (NV-20) y el formato del número de pedido (NV-15), que piden
  cambio de contrato; una forma de cambiar la contraseña del admin sin consola (hoy pide el plan
  pago de Render); y un caché compartido de la tienda, solo si algún día hay más de un servidor
  propio.
- **Mercado Pago: pasar de la API de Payments a la API de Orders.** El 2026-11-18, al crear la
  aplicación de Mercado Pago (Checkout API), el panel ofrece "API de Orders" y "API de Payments" y
  avisa que la de Payments "será descontinuada pronto". Se eligió **API de Payments** porque es la
  que usa el back (`src/modules/payments`: preferencias y `/v1/payments` detrás de
  `PaymentGatewayPort`). Cuando Mercado Pago anuncie la fecha de corte, hay que migrar el adaptador
  de Mercado Pago (`MercadoPagoGateway`, `mercadopago.mapper.ts`, el webhook y la conciliación) a
  la API de Orders, con su prueba contra el sandbox, y crear o reconfigurar la aplicación con
  "API de Orders". El puerto `PaymentGatewayPort` aísla el cambio del resto del back.
