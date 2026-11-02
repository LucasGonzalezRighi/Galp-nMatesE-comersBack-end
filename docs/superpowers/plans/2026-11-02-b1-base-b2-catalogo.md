# B1 · Base y B2 · Catálogo y contenido — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** levantar el backend de Galpón Mates (NestJS hexagonal) con su base de datos, su núcleo compartido y las lecturas públicas del contrato, de modo que la tienda del front funcione contra `http://localhost:3001` con los mismos datos del diseño.

**Architecture:** monolito modular en NestJS 12 con capas `domain / application / infrastructure / interface` por módulo y la regla de dependencias vigilada por `eslint-plugin-boundaries`. PostgreSQL con Prisma 7 (driver adapter `pg`) solo en los adaptadores; Redis con ioredis para caché, rate limiting y BullMQ (outbox). El contrato `openapi.yaml` del front es la fuente de verdad: un test compara el Swagger generado con él.

**Tech Stack:** Node 22, TypeScript 6, NestJS 12.3.2 (`@nestjs/swagger` 12.1.0, `@nestjs/config` 12.0.1, `@nestjs/terminus` 12.1.0, `@nestjs/throttler` 6.7.1 + `@nest-lab/throttler-storage-redis` 1.2.0, `@nestjs/bullmq` 12.0.0), Prisma 7.10.1 (`prisma` y `@prisma/client` 7.10.1, `@prisma/adapter-pg` 7.10.1, `pg`), bullmq 6.5.3, ioredis 6.0.0, pino 10.4.0 + nestjs-pino 5.3.1, zod 4.6.7, helmet 8.3.0, class-validator 0.15.1, class-transformer 0.5.1, uuid 14.0.3, vitest 5.0.5 + unplugin-swc 2.0.0 + @swc/core 1.16.21, supertest 7.3.1, testcontainers 12.2.1 (`@testcontainers/postgresql`, `@testcontainers/redis`), yaml 2.9.1, eslint 10 + typescript-eslint 8.72.1 + eslint-plugin-boundaries 7.4.1, prettier 3.9.10, lefthook 2.2.2.

**Spec:** `docs/superpowers/specs/2026-10-20-galpon-backend-design.md` (copiado del front; aprobado por Lucas el 2026-11-02). Contrato: `../frontend/docs/api/openapi.yaml` (6027 líneas, 77 operaciones; `docs/api/README.md` y `validation-cases.json` al lado). Datos del diseño: `../frontend/packages/api-client/src/mock/fixtures/{categories,products,content,reviews,settings}.ts`.

## Global Constraints

- Solo commits locales en `backend/` (rama `main`); nunca `git push` ni remotos: Lucas agrega el remoto `LucasGonzalezRighi/Galp-nMatesE-comersBack-end` y pushea. No tocar `../frontend` (salvo leerlo).
- Versiones exactas (sin `^`) y verificadas con `scripts/check-dependency-versions.mjs` (copiar el patrón del front). `prisma` fijado en 7.10.1: el tag `latest` es una RC de la 8 y no se usa (spec §10).
- Puerto 3001 (spec del front, `.env.example` del front: `API_BASE_URL=http://localhost:3001`). CORS con credenciales solo para `http://localhost:5173` en desarrollo (variable `ADMIN_ORIGIN`); la tienda no necesita CORS.
- Prefijo global `/api/v1`; Swagger UI en `/api/docs` (abierto en desarrollo); errores siempre `application/problem+json` (RFC 9457) con la forma `Problem` del contrato (`type, title, status, detail, instance, errors[]`), textos en español rioplatense; listas paginadas `{ items, page, pageSize, total }` con `pageSize` 1–100 (default 24).
- IDs `uuid` v7 generados por la app (`uuid` 14, `v7()`); montos `integer` en pesos con sufijo `_ars`; fechas `timestamptz`; tablas `snake_case` mapeadas con `@map`/`@@map`.
- `domain/` sin imports externos; `application/` importa solo `domain` y define puertos; `infrastructure/` implementa puertos; `interface/` llama a `application`. `eslint-plugin-boundaries` lo falla en `npm run lint`.
- TS estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), sin `any`, sin `!` no-null, TSDoc en español en todo lo exportado, identificadores en inglés y textos de errores en español. Commits convencionales en español.
- Verificación local de cada tarea: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (unitarios) y, cuando la tarea toca Prisma o HTTP, `npm run test:e2e` (Testcontainers: necesita Docker Desktop abierto). Docker: `docker compose up -d` levanta `postgres:17` y `redis:8` para desarrollo.

## Review Focus

1. **Doble arranque contra la misma base:** dos instancias (o un reinicio a medias de migración) no deben romper el esquema: `prisma migrate deploy` es idempotente y el seed es `upsert` por `slug`/`key` (test en Task 7).
2. **`pageSize=1000` o `page=0` en `/products`:** 422 `problem+json` con `errors[]` por campo, nunca 500 (test en Task 9).
3. **Slug viejo de un producto renombrado:** `GET /products/{slug}` con un slug de `product_slug_history` devuelve el producto (no 404) (test en Task 9).
4. **Redis caído:** las lecturas públicas siguen respondiendo desde Postgres (la caché falla "abierta") y `/health` lo informa como `degraded` sin devolver 500 (test en Task 8 y Task 4).
5. **Request con `Idempotency-Key` repetida y otro cuerpo:** 422; con la misma clave mientras se procesa: 409; completada: misma respuesta guardada (test en Task 5, aunque el primer consumidor real llega en B4).

---

### Task 1: Esqueleto del repo, herramientas y calidad

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.nvmrc` (`22`), `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `lefthook.yml`, `vitest.config.ts`, `vitest.e2e.config.ts`, `scripts/dependency-versions.json`, `scripts/check-dependency-versions.mjs`, `README.md`, `src/main.ts`, `src/app.module.ts`, `src/modules/health/health.module.ts`, `src/modules/health/interface/health.controller.ts`, `test/e2e/health.e2e-spec.ts`, `test/support/app.ts`
- Modify: (nada; repo nuevo con `docs/` ya copiado)

**Interfaces:**
- Produces: `createApp(): Promise<INestApplication>` en `test/support/app.ts` (arma la app como `main.ts`, sin escuchar puerto; el E2E la cierra con `app.close()`); scripts `dev` (`nest start --watch`), `build`, `start`, `typecheck` (`tsc --noEmit -p tsconfig.json`), `lint` (`node scripts/check-dependency-versions.mjs && eslint .`), `format` / `format:check`, `test` (`vitest run`), `test:e2e` (`vitest run -c vitest.e2e.config.ts`).

- [ ] **Step 1: Inicializar el proyecto con las versiones exactas**

`npm init -y`, `name: @galpon/backend`, `private: true`, `engines.node: ">=22.18"`, `type` sin definir (CommonJS, lo que pide Nest). Dependencias de producción: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` 12.3.2, `@nestjs/swagger` 12.1.0, `@nestjs/config` 12.0.1, `@nestjs/terminus` 12.1.0, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `helmet` 8.3.0, `zod` 4.6.7, `pino` 10.4.0, `nestjs-pino` 5.3.1, `pino-http` (la versión que exige nestjs-pino 5.3.1: verificar con `npm view nestjs-pino@5.3.1 peerDependencies`). Desarrollo: `@nestjs/cli` 12.0.11, `@nestjs/testing` 12.3.2, `typescript` 6.0.3 (la del front; si Nest 12 no compila con 6, bajar a la 5.9 más alta y anotarlo en el README), `vitest` 5.0.5, `unplugin-swc` 2.0.0, `@swc/core` 1.16.21, `supertest` 7.3.1, `@types/supertest` 7.2.1, `@types/node` 22.20.5, `@types/express` 5.0.6, `eslint` 10.14.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.72.1, `eslint-plugin-boundaries` 7.4.1, `eslint-config-prettier` 10.1.8, `prettier` 3.9.10, `lefthook` 2.2.2, `yaml` 2.9.1. Todo sin `^`. Guardar la lista en `scripts/dependency-versions.json` y copiar `check-dependency-versions.mjs` del front adaptado a un solo `package.json`.

- [ ] **Step 2: Escribir el E2E de salud que falla**

```ts
// test/e2e/health.e2e-spec.ts
it('GET /api/v1/health responde 200 con status ok', async () => {
  const app = await createApp()
  const res = await request(app.getHttpServer()).get('/api/v1/health')
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ status: 'ok' })
  await app.close()
})
```

- [ ] **Step 3: Correrlo y ver que falla** — `npm run test:e2e` → FAIL (no existe `createApp`).

- [ ] **Step 4: Implementar `main.ts`, `AppModule`, `HealthModule` y `createApp`**

`main.ts`: `NestFactory.create(AppModule, { bufferLogs: true })`, `app.setGlobalPrefix('api/v1')`, `helmet()`, `app.enableShutdownHooks()`, `listen(env.PORT)`. `HealthController` (`@Controller('health')`, `@Get()`) devuelve por ahora `{ status: 'ok' }` (Terminus con Postgres y Redis llega en Task 4). `createApp` en `test/support/app.ts` usa `Test.createTestingModule({ imports: [AppModule] })` y aplica la misma configuración de `main.ts` (extraer esa configuración a `src/app.setup.ts` → `setupApp(app: INestApplication): void` para no duplicarla).

- [ ] **Step 5: Correr y ver que pasa** — `npm run test:e2e` → PASS. `npm run typecheck`, `npm run lint`, `npm run format:check` en verde (eslint con `boundaries` configurado para `src/modules/*/{domain,application,infrastructure,interface}` y `src/shared/*`; sin archivos todavía que lo violen).

- [ ] **Step 6: README inicial** (qué es, requisitos: Node 22 + Docker Desktop, `npm install`, scripts, puerto 3001, que el contrato vive en el front) y commit.

```bash
git add -A -- . ':!node_modules' && git commit -m "chore: esqueleto de NestJS 12 con calidad, vitest y health"
```

### Task 2: Configuración validada con Zod y logger pino

**Files:**
- Create: `src/config/env.schema.ts`, `src/config/env.ts`, `src/config/config.module.ts`, `src/config/env.spec.ts`, `src/shared/infrastructure/logger/logger.module.ts`, `.env.example`
- Modify: `src/app.module.ts`, `src/main.ts`, `src/app.setup.ts`

**Interfaces:**
- Produces: `interface Env { NODE_ENV: 'development'|'test'|'production'; PORT: number; DATABASE_URL: string; REDIS_URL: string; ADMIN_ORIGIN: string; STORE_ORIGIN: string; LOG_LEVEL: 'debug'|'info'|'warn'|'error' }`, `parseEnv(source: Record<string, string | undefined>): Env` (lanza `Error` en español listando las variables inválidas), token `ENV` inyectable (`@Inject(ENV) env: Env`).

- [ ] **Step 1: Test de `parseEnv`**: con `{}` lanza un error que menciona `DATABASE_URL` y `REDIS_URL`; con `PORT: 'abc'` menciona `PORT`; con un entorno completo devuelve `PORT` 3001 por defecto y `LOG_LEVEL` `info`.
- [ ] **Step 2: Correr → FAIL.**
- [ ] **Step 3: Implementar** `env.schema.ts` (zod: `PORT` `coerce.number().int().min(1).max(65535).default(3001)`, URLs con `z.url()`, `ADMIN_ORIGIN` default `http://localhost:5173`, `STORE_ORIGIN` default `http://localhost:3000`), `parseEnv`, `ConfigModule` (global, provee `ENV` con `parseEnv(process.env)`), `LoggerModule` con `nestjs-pino` (`pino-http`, nivel `LOG_LEVEL`, `redact` de `req.headers.cookie`, `req.headers.authorization` y `res.headers["set-cookie"]`, `transport` `pino-pretty` solo en desarrollo si está instalado; en `test`, nivel `silent`). `main.ts`: `app.useLogger(app.get(Logger))`.
- [ ] **Step 4: `.env.example`** con las siete variables comentadas en español (`DATABASE_URL=postgresql://galpon:galpon@localhost:5432/galpon`, `REDIS_URL=redis://localhost:6379`).
- [ ] **Step 5: Correr todo → PASS; commit** `feat: configuración validada con zod y logger pino`.

### Task 3: Docker, Prisma 7 y el esquema de B2

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/<timestamp>_b2_catalogo_contenido/migration.sql` (generada), `src/shared/infrastructure/prisma/prisma.module.ts`, `src/shared/infrastructure/prisma/prisma.service.ts`, `test/support/containers.ts`, `test/e2e/prisma.e2e-spec.ts`
- Modify: `package.json` (scripts `db:up`, `db:migrate`, `db:generate`, `db:seed`, `db:reset`), `.gitignore`

**Interfaces:**
- Produces: `PrismaService extends PrismaClient` (con `@prisma/adapter-pg` y `pg.Pool` desde `DATABASE_URL`; `onModuleInit` conecta, `onModuleDestroy` desconecta) exportado por `PrismaModule` (global). `startContainers(): Promise<{ databaseUrl: string; redisUrl: string; stop(): Promise<void> }>` en `test/support/containers.ts` (Testcontainers `postgres:17-alpine` y `redis:8-alpine`; corre `prisma migrate deploy` contra la base nueva con `execSync`).
- Modelos Prisma (spec §4.2, §4.5 y lo que B2 lee): `Category`, `Product`, `ProductSlugHistory`, `MediaAsset`, `ProductImage`, `Inventory`, `Review`, `ContentBlock`, `Settings`, `ShippingOption`, `OutboxEvent`, `IdempotencyKey`. Enums Postgres: `ProductGroup (mate|bombilla|yerba)`, `ProductStatus (draft|published|archived)`, `ReviewStatus (pending|approved|hidden)`, `IdempotencyStatus (processing|completed)`. `Review.rating` es `Decimal(2,1)` con CHECK `rating >= 1 AND rating <= 5 AND rating * 2 = floor(rating * 2)` (medias estrellas, ruling del front MR-30 en su BITACORA) agregado a mano en la migración.

- [ ] **Step 1: `docker-compose.yml`** con `postgres:17` (user/pass/db `galpon`, puerto 5432, volumen) y `redis:8` (6379); scripts `db:up` (`docker compose up -d`), `db:migrate` (`prisma migrate dev`), `db:generate`, `db:reset` (`prisma migrate reset --force`).
- [ ] **Step 2: Escribir el E2E** `prisma.e2e-spec.ts`: levanta contenedores, crea la app, `prisma.category.count()` devuelve 0, y `prisma.$queryRaw\`SELECT 1\`` responde.
- [ ] **Step 3: Correr → FAIL** (no hay Prisma).
- [ ] **Step 4: Implementar** `schema.prisma` (generator `prisma-client` con `engineType`/driver adapters según Prisma 7, `previewFeatures` ninguna; `@@map` a `snake_case`, `@db.Citext` para emails más adelante: por ahora habilitar la extensión `citext` en la migración), `prisma.config.ts` (Prisma 7 lee `DATABASE_URL` desde ahí), `prisma migrate dev --name b2_catalogo_contenido` contra `db:up`, `PrismaService` con el adapter `pg`, `PrismaModule` global.
- [ ] **Step 5: Correr → PASS** (`npm run test:e2e` con Docker abierto); commit `feat: prisma 7 con postgres y redis en docker, esquema de catálogo y contenido`.

### Task 4: Redis, caché, rate limiting y health real

**Files:**
- Create: `src/shared/infrastructure/redis/redis.module.ts`, `src/shared/infrastructure/redis/redis.service.ts`, `src/shared/application/ports/cache.port.ts`, `src/shared/infrastructure/redis/redis-cache.adapter.ts`, `src/shared/infrastructure/redis/redis-cache.adapter.spec.ts`, `src/shared/infrastructure/throttler/throttler.module.ts`
- Modify: `src/modules/health/interface/health.controller.ts` (Terminus: `PrismaHealthIndicator` propio con `SELECT 1` y `RedisHealthIndicator` con `PING`; Redis caído → `status: 'degraded'` y HTTP 200, Postgres caído → 503), `src/app.module.ts`, `test/e2e/health.e2e-spec.ts`

**Interfaces:**
- Produces: `interface CachePort { get<T>(key: string): Promise<T | null>; set<T>(key: string, value: T, ttlSeconds: number): Promise<void>; del(...keys: string[]): Promise<void> }` con token `CACHE_PORT`; `RedisCacheAdapter` implementa el puerto y **nunca lanza**: si ioredis falla, `get` devuelve `null`, `set`/`del` no hacen nada y se loguea un `warn` una vez por minuto. `ThrottlerModule` global con almacenamiento Redis (`@nest-lab/throttler-storage-redis`): 120 pedidos/min por IP en rutas públicas (`@Throttle` por controlador cuando haga falta); respuesta 429 como `problem+json` (la convierte el filtro de Task 5).

- [ ] **Step 1: Test unitario** de `RedisCacheAdapter` con un ioredis simulado que rechaza: `get` → `null`, `set` → no lanza; con uno que funciona, `set` + `get` devuelven el mismo objeto (JSON) y `del` lo borra.
- [ ] **Step 2: Correr → FAIL.** **Step 3: Implementar.** **Step 4: E2E de health:** con contenedores arriba, `{ status: 'ok', info: { database: { status: 'up' }, redis: { status: 'up' } } }`; con el contenedor de Redis detenido (`containers.stopRedis()`), `status: 'degraded'` y HTTP 200. **Step 5: PASS; commit** `feat: redis con caché que falla abierta, rate limiting y health con terminus`.

### Task 5: Núcleo compartido: errores `problem+json`, validación, idempotencia y outbox

**Files:**
- Create: `src/shared/domain/pesos.ts` (+ spec), `src/shared/domain/domain-error.ts` (`DomainError` con `code`, `status`, `detail`), `src/shared/domain/result.ts`, `src/shared/domain/clock.ts` (`CLOCK` token, `SystemClock`), `src/shared/domain/id.ts` (`newId(): string` con `uuid` v7, `isId`), `src/shared/domain/domain-event.ts`, `src/shared/infrastructure/http/problem.filter.ts` (+ spec), `src/shared/infrastructure/http/validation.pipe.ts`, `src/shared/infrastructure/http/page.dto.ts` (`PageQueryDto` con `page` ≥ 1 default 1 y `pageSize` 1–100 default 24, `class-validator`), `src/shared/infrastructure/http/page.ts` (`interface Page<T> { items: T[]; page: number; pageSize: number; total: number }`), `src/shared/infrastructure/idempotency/idempotency.interceptor.ts` (+ e2e), `src/shared/infrastructure/idempotency/idempotency.repository.ts`, `src/shared/infrastructure/outbox/outbox.module.ts`, `src/shared/infrastructure/outbox/outbox.repository.ts`, `src/shared/infrastructure/outbox/outbox.relay.ts` (+ e2e), `src/shared/shared.module.ts`
- Modify: `src/app.setup.ts` (filtro global, pipe global `ValidationPipe` con `whitelist`, `forbidNonWhitelisted`, `transform`, y `exceptionFactory` que arma `errors[]` con `{ field, message }` en español), `src/app.module.ts`, `package.json` (`bullmq` 6.5.3, `ioredis` 6.0.0, `@nestjs/bullmq` 12.0.0, `uuid` 14.0.3, `class-validator` 0.15.1, `class-transformer` 0.5.1, `@types/uuid` si hace falta)

**Interfaces:**
- Produces: `Pesos` (value object: `Pesos.of(n)` entero ≥ 0, `add`, `multiply`, `percentOff(p)`, `toNumber()`; lanza `RangeError` en español con decimales o negativos); `ProblemFilter` (todo error → `application/problem+json` con `type` `https://galponmates.com.ar/problems/<code>`, `title`, `status`, `detail`, `instance` = ruta, `errors` solo en 422; `HttpException` de Nest y `DomainError` mapeados; errores desconocidos → 500 con `detail` genérico y log `error` con el stack); `@Idempotent(scope: string)` + `IdempotencyInterceptor` (header `Idempotency-Key` UUID obligatorio → 422 si falta o no es UUID; `(scope, key)` en la tabla `idempotency_keys` con `INSERT … ON CONFLICT`; mismo cuerpo completado → respuesta guardada con header `Idempotent-Replayed: true`; cuerpo distinto → 422 `idempotency_key_reused`; en proceso → 409 `idempotency_in_progress`; `expires_at` 24 h); `OutboxRepository.append(tx, event: DomainEvent)` y `OutboxRelay` (cada 2 s toma hasta 50 eventos sin `published_at`, los publica en la cola BullMQ `outbox` con `jobId` = id del evento, marca `published_at`; reintentos con backoff exponencial, 5 intentos).

- [ ] **Step 1: Specs unitarios** de `Pesos` (suma, porcentaje con redondeo al peso, `RangeError` con `1.5` y `-1`), del `ProblemFilter` (un `NotFoundException('Producto no encontrado')` → 404 con `type` `…/not-found`, `title` `No encontrado`, `detail` el mensaje; un `BadRequestException` de validación → 422 con `errors[]`), y del interceptor de idempotencia (con un repositorio en memoria): falta el header → 422; dos llamadas iguales → segunda replica la primera; cuerpo distinto → 422; en proceso → 409.
- [ ] **Step 2: Correr → FAIL. Step 3: Implementar.** Un controlador de prueba solo en `test/` (`test/support/idempotency.controller.ts`, `POST /api/v1/_test/idempotent`, registrado solo cuando `NODE_ENV=test`) para el E2E del interceptor contra Postgres real.
- [ ] **Step 4: E2E del outbox:** `OutboxRepository.append` dentro de una transacción + el relay publican un job en la cola `outbox` (BullMQ contra el Redis del contenedor) con el payload del evento; un segundo `append` del mismo id no duplica el job.
- [ ] **Step 5: PASS; commit** `feat: núcleo compartido con pesos, errores problem+json, idempotencia y outbox`.

### Task 6: Swagger y test de contrato contra el front

**Files:**
- Create: `src/swagger.ts` (`buildOpenApiDocument(app): OpenAPIObject` con `DocumentBuilder` título "Galpón Mates API", versión `1.0.0`, servidor `/api/v1`, esquemas de seguridad `cookie` `session`), `test/contract/openapi.contract.spec.ts`, `test/contract/normalize.ts`, `scripts/openapi-diff.mjs`
- Modify: `src/main.ts` (`SwaggerModule.setup('api/docs', …)` solo si `NODE_ENV !== 'production'`), `package.json` (script `contract:check`)

**Interfaces:**
- Produces: `normalizeOpenApi(doc: OpenAPIObject | ContractDocument): NormalizedContract` (ordena claves, quita `description`/`example`/`summary`/`x-*`, resuelve `$ref` a nombres, aplana `allOf` de un solo elemento) y el test que compara **solo las rutas ya implementadas** (lista `IMPLEMENTED_PATHS` en el test; en B2 son las 13 lecturas públicas) con el `openapi.yaml` del front leído desde `../frontend/docs/api/openapi.yaml` (ruta configurable con `CONTRACT_PATH`); cualquier diferencia de parámetros, códigos de respuesta o esquema de respuesta falla con un diff legible. Las rutas no implementadas se listan como "pendientes" en la salida, no fallan.

- [ ] **Step 1: Test** que, con solo `/health` implementado, pasa (lista vacía) y reporta 77 rutas pendientes; y un test de `normalizeOpenApi` (dos documentos iguales salvo `description` y orden de claves → iguales).
- [ ] **Step 2: FAIL → implementar → PASS; commit** `feat: swagger en /api/docs y test de contrato contra el openapi del front`.

### Task 7: Seed con los datos del diseño

**Files:**
- Create: `prisma/seed.ts`, `prisma/seed-data/categories.ts`, `prisma/seed-data/products.ts`, `prisma/seed-data/content.ts`, `prisma/seed-data/reviews.ts`, `prisma/seed-data/settings.ts`, `prisma/seed-data/README.md`, `scripts/import-fixtures.mjs`, `test/e2e/seed.e2e-spec.ts`
- Modify: `package.json` (`db:seed` = `tsx prisma/seed.ts`; `prisma.config.ts` con `migrations.seed`)

**Interfaces:**
- Produces: `seed(prisma: PrismaClient): Promise<SeedSummary>` (`{ categories: number; products: number; reviews: number; contentBlocks: number }`), idempotente: `upsert` por `slug` (categorías y productos), por `(productId, position)` (fotos), por `key` (contenidos), `id = 1` (settings), y reseñas por un id determinístico derivado de `(productSlug, authorName, createdAt)`. `scripts/import-fixtures.mjs` lee las fixtures del front con `tsx` y escribe `prisma/seed-data/*.ts` como datos planos (sin importar nada del front en runtime): se corre a mano cuando cambian las fixtures y el resultado se commitea.

- [ ] **Step 1: Correr `scripts/import-fixtures.mjs`** y revisar: 6 categorías, 27 productos (16 mates, 8 bombillones, 3 yerbas; precios en `price_ars`, fotos como `media_assets` con `url` de `/mock-images/*.jpg` → en el back se guardan con `provider: 'local'` y la misma `url`, que la tienda sirve; `inventory.on_hand` 10 por producto, 0 para los `isSoldOut` de la fixture), 15 reseñas (5 destacadas, ratings con 4,5), contenidos `home`, `about`, `faq`, `footer`, `product-tabs`, `legal-terms`, `legal-privacy`, settings y `shipping_options`.
- [ ] **Step 2: E2E** `seed.e2e-spec.ts`: `seed()` dos veces seguidas deja los mismos conteos (idempotente) y `products` publicados = 27.
- [ ] **Step 3: FAIL → implementar → PASS; commit** `feat: seed idempotente con los datos del diseño`.

### Task 8: Módulos `catalog`, `content`, `reviews` (lectura) y `settings` (público)

**Files:**
- Create (por módulo, con el patrón de la spec §3.3):
  - `src/modules/catalog/domain/{category,product,product-image,inventory}.entity.ts` (+ specs: `Product.isPurchasable()` = publicado y disponible > 0, `Product.code()` = `N°` + secuencia con dos dígitos), `application/ports/{category,product}.repository.port.ts`, `application/queries/{list-categories,list-products,get-product,get-related-products}.query.ts` (+ specs con repos en memoria), `infrastructure/prisma-{category,product}.repository.ts`, `infrastructure/{category,product}.mapper.ts`, `infrastructure/cached-product.repository.ts` (decora el repo con `CachePort`, TTL 60 s, claves `catalog:*`), `catalog.module.ts`
  - `src/modules/content/...` (`ContentBlock` por `key`, `GetContentQuery(key)`, repo Prisma + caché 300 s), `src/modules/settings/...` (`GetPublicSettingsQuery`), `src/modules/reviews/...` (`ListProductReviewsQuery(slug, page)` solo `approved`, `ListFeaturedReviewsQuery` (forma `FeaturedReview`), y `ReviewStats` del contrato (`ReviewPage.stats`: `average` sin redondear, 0 sin reseñas; `distribution` donde una media cuenta en la fila de su parte entera) y `Rating` (`average`, `count`) para `ProductSummary.rating`).
- Test: specs unitarios de dominio y de queries; `test/e2e/catalog.repository.e2e-spec.ts` contra Postgres con el seed.

**Interfaces:**
- Produces: `ListProductsQuery.execute(filter: ProductFilter): Promise<Page<ProductSummary>>` con `ProductFilter { category?: string; group?: ProductGroup; ids?: string[]; q?: string; sort: 'destacados'|'menor'|'mayor'|'az'; featured?: boolean; page: number; pageSize: number }` (orden `destacados` = `featured desc, sequence asc`; `q` busca en nombre y descripción con `ILIKE`); `GetProductQuery.execute(slug): Promise<ProductDetail | null>` (resuelve `product_slug_history`); `GetRelatedProductsQuery.execute(slug): Promise<ProductSummary[]>` (hasta 4 de la misma categoría publicados, sin el propio, por `sequence`). Los tipos `ProductSummary`, `ProductDetail`, `Category`, `Review`, `HomeContent`… viven en `src/modules/*/application/read-models.ts` y copian **exactamente** las formas del contrato (`components/schemas` de `openapi.yaml`); `rating.average` y `count` se calculan desde las reseñas aprobadas.

- [ ] **Step 1: Specs** de entidades y queries (en memoria). **Step 2: FAIL → implementar.** **Step 3: E2E del repositorio Prisma:** con el seed, `listProducts({ group: 'mate', sort: 'menor', page: 1, pageSize: 100 })` devuelve 16 ordenados por precio ascendente con `total` 16; `getProduct('mate-imperial-premium')` trae 2 fotos y `rating.average` 4,7; con Redis detenido las mismas lecturas responden (caché que falla abierta, Review Focus 4). **Step 4: PASS; commit** `feat: módulos de catálogo, contenido, reseñas y ajustes con lecturas cacheadas`.

### Task 9: Controladores públicos del contrato (13 rutas) y contrato en verde

**Files:**
- Create: `src/modules/catalog/interface/{categories,products}.controller.ts`, `src/modules/catalog/interface/dto/{list-products.query.dto,product-slug.param.dto}.ts`, `src/modules/content/interface/content.controller.ts` (+ `legal-document.param.dto.ts`: `terms|privacy` según el contrato), `src/modules/settings/interface/settings.controller.ts`, `src/modules/reviews/interface/reviews.controller.ts` (solo GET en B2; `POST /products/{slug}/reviews` queda para B7 y se lista como pendiente), DTOs de respuesta decorados con `@ApiProperty` para que Swagger reproduzca los esquemas del contrato, `test/e2e/public-reads.e2e-spec.ts`
- Modify: `test/contract/openapi.contract.spec.ts` (`IMPLEMENTED_PATHS` = las 13 lecturas públicas), `README.md` (cómo correr la tienda del front contra este back: `API_MODE=live` y `API_BASE_URL=http://localhost:3001`)

**Interfaces:**
- Consumes: las queries de Task 8, `PageQueryDto`, `ProblemFilter`, `ThrottlerModule`.

- [ ] **Step 1: E2E** `public-reads.e2e-spec.ts` (con seed): `GET /api/v1/categories` → 200 con 6 ítems ordenados por `position`; `GET /api/v1/products?pageSize=100` → 27 ítems, `total` 27; `?category=imperiales&sort=menor` ordenado; `?pageSize=1000` → 422 `problem+json` con `errors[0].field` `pageSize` (Review Focus 2); `?page=0` → 422; `GET /products/mate-imperial-premium` → 200 con `code` `N°01`, `images` de 2 y `rating`; `GET /products/no-existe` → 404 `problem+json`; un slug de `product_slug_history` → 200 con el producto (Review Focus 3; insertar la fila de historial en el test); `GET /products/{slug}/related` → ≤ 4 de la misma categoría; `GET /products/{slug}/reviews` → `{ items, page, pageSize, total, stats }` solo aprobadas; `GET /reviews/featured` → 5; `GET /content/home` con la forma `HomeContent`; `GET /content/legal/terms` y `/privacy` → 200 y `/content/legal/otro` → 422 (el parámetro es un enum `terms|privacy`); `GET /settings/public` → `kitDiscountPercent` 10.
- [ ] **Step 2: FAIL → implementar → PASS.** **Step 3: `npm run contract:check`** con las 13 rutas en `IMPLEMENTED_PATHS` → sin diferencias (ajustar DTOs hasta que coincida). **Step 4: Probar la tienda del front** contra este back: `docker compose up -d`, `npm run db:migrate && npm run db:seed && npm run dev` acá; en el front, `apps/store/.env.local` con `API_MODE=live`, `NEXT_PUBLIC_API_MODE=live`, `API_BASE_URL=http://localhost:3001`, un `REVALIDATE_SECRET` de 32+ caracteres y un `NEXT_PUBLIC_MP_PUBLIC_KEY` de prueba (`TEST-…`), `npm run build -w @galpon/store && npx next start apps/store --port 4300`; `curl http://localhost:4300/` y `/tienda` responden 200 con los 27 productos renderizados (capturar la salida en el reporte). **Step 5: commit** `feat: lecturas públicas del contrato (catálogo, contenido, reseñas, ajustes)`.

### Task 10: Cierre de B1 y B2: lint de fronteras, CI local y docs

**Files:**
- Create: `.github/workflows/ci.yml` (typecheck, lint, format, test, test:e2e con servicios `postgres:17` y `redis:8`, contract:check con el front clonado al lado), `docs/BITACORA.md` (B1 y B2: qué quedó, decisiones, versiones reales instaladas), `docs/adr/0001-nest-hexagonal-monolito.md`, `docs/adr/0002-prisma-7-driver-adapter-pg.md`
- Modify: `README.md`, `eslint.config.js` (un test negativo: `test/lint/boundaries.spec.ts` que corre ESLint sobre un archivo temporal donde `domain` importa `@prisma/client` y espera el error de `boundaries`)

- [ ] **Step 1: Test de fronteras** → FAIL si la regla no existe → configurar → PASS.
- [ ] **Step 2: Verificación completa**: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e && npm run contract:check` en verde.
- [ ] **Step 3: Docs y commit** `docs: bitácora de B1 y B2, ADRs y CI`.
