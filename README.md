# Galpón Mates · backend

API de Galpón Mates: un monolito modular en **NestJS 12** con arquitectura hexagonal (cada módulo
en capas `domain / application / infrastructure / interface`), PostgreSQL con Prisma 7 y Redis.
La tienda y el admin del front la consumen en `http://localhost:3001/api/v1`.

- **Diseño:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](docs/superpowers/specs/2026-10-20-galpon-backend-design.md).
- **Bitácora** (qué se hizo en cada pieza, decisiones y versiones): [`docs/BITACORA.md`](docs/BITACORA.md).
- **Decisiones de arquitectura:** [ADR 0001 · monolito hexagonal](docs/adr/0001-nest-hexagonal-monolito.md)
  y [ADR 0002 · Prisma 7 con `pg`](docs/adr/0002-prisma-7-driver-adapter-pg.md).
- **Contrato (fuente de verdad):** vive en el repo del front, `../frontend/docs/api/openapi.yaml`.
  El back lo implementa; no se edita desde acá.

## Requisitos

- Node 22 (`.nvmrc`; mínimo 22.18) y npm 10.
- Docker Desktop abierto: Postgres y Redis de desarrollo y los E2E con Testcontainers.
- El repo del front clonado al lado, en `../frontend` (el test de contrato y el script que importa
  los datos del diseño lo leen de ahí).

## Puertos y orígenes

| Qué                    | Dónde                   | Notas                                                 |
| ---------------------- | ----------------------- | ----------------------------------------------------- |
| Tienda (Next.js)       | `http://localhost:3000` | `STORE_ORIGIN`. Llega al back desde su servidor.      |
| Admin (Vite)           | `http://localhost:5173` | `ADMIN_ORIGIN`. El único origen con CORS.             |
| Este back              | `http://localhost:3001` | `PORT`. Prefijo `/api/v1`; Swagger UI en `/api/docs`. |
| Postgres / Redis (dev) | `5432` / `6379`         | `docker compose` (`npm run db:up`).                   |

**CORS:** solo `ADMIN_ORIGIN` (en desarrollo `http://localhost:5173`) recibe permiso, con
credenciales (las cookies de sesión del admin). La tienda no lo necesita: su servidor llama al back
y reescribe `/api/v1/*` hacia él, así que el navegador siempre habla con la tienda. Un pedido desde
otro origen no recibe cabeceras CORS y el navegador lo bloquea.

## Puesta en marcha

```bash
cp .env.example .env    # valores de desarrollo; las variables del entorno tienen prioridad
npm install             # también genera el cliente de Prisma e instala los hooks de git
npm run db:up           # Postgres 17 y Redis 8 con docker compose (espera a que estén sanos)
npm run db:migrate      # aplica las migraciones
npm run db:seed         # carga los datos del diseño (se puede repetir)
npm run dev             # nest start --watch en http://localhost:3001
```

- Salud: `GET http://localhost:3001/api/v1/health` (`ok`; `degraded` si Redis cae; 503 si cae
  Postgres). Si falta una variable obligatoria o la base no responde, la API no arranca y el error
  dice qué corregir.
- Swagger UI: `http://localhost:3001/api/docs` (y el JSON en `/api/docs-json`). No se monta con
  `NODE_ENV=production`.

## Docker

`docker-compose.yml` levanta `postgres:17-alpine` (usuario, clave y base `galpon`) y
`redis:8-alpine`, con volúmenes y healthchecks. `npm run db:down` los apaga y conserva los datos;
`docker compose down -v` también borra los volúmenes (la base queda vacía: hay que migrar y sembrar
de nuevo).

Los E2E no usan esos contenedores: cada archivo levanta los suyos con Testcontainers (puertos
aleatorios) y los cierra al terminar. Solo necesitan Docker Desktop abierto.

## Base de datos y seed

- **Migraciones** en `prisma/migrations/`: `npm run db:migrate` en desarrollo y
  `npx prisma migrate deploy` en CI y producción. `npm run db:reset` borra la base de desarrollo y
  vuelve a migrar (después, `npm run db:seed`).
- **Cliente de Prisma** en `src/generated/prisma` (no se versiona): lo genera `postinstall`, o
  `npm run db:generate` después de cambiar `prisma/schema.prisma`.
- **Seed** (`npm run db:seed` o `npx prisma db seed`): 6 líneas, 27 productos, 15 reseñas
  (5 destacadas), 7 contenidos, ajustes y 3 envíos, los mismos datos de las fixtures del front. Es
  idempotente (`upsert` por `slug`/`key`): correrlo dos veces deja lo mismo.
- Los datos salen de `prisma/seed-data/`, que se regenera desde las fixtures del front con
  `node scripts/import-fixtures.mjs` (ver [`prisma/seed-data/README.md`](prisma/seed-data/README.md)).

## Contrato

`npm run contract:check` arma la app (sin Docker), genera el Swagger y lo compara, normalizado,
con `../frontend/docs/api/openapi.yaml` (o `CONTRACT_PATH`). Falla si una operación implementada
difiere del contrato o si Swagger expone una ruta que no está en `IMPLEMENTED_PATHS`
(`test/contract/openapi.contract.spec.ts`), y lista las operaciones pendientes (hoy, 13
implementadas y 64 pendientes de 77).

Para ver las diferencias de una ruta: `node scripts/openapi-diff.mjs products/{slug}` (en Git Bash,
sin `/` inicial o entre comillas, para que no la convierta en una ruta de Windows).

## Probar la tienda contra este back

Las 13 lecturas públicas del contrato (`/categories`, `/products…`, `/reviews/featured`,
`/content/*`, `/settings/public`) están implementadas, sin límite de pedidos por IP (la tienda las
pide desde un solo servidor). **Todavía no se probaron contra Postgres** (los E2E ni esta prueba):
Docker Desktop no arrancaba en la máquina de desarrollo (ver [`docs/BITACORA.md`](docs/BITACORA.md)).

1. Acá, con Docker Desktop abierto: `npm run db:up`, `npm run db:migrate`, `npm run db:seed` y
   `npm run dev`.

2. En el front (`../frontend`), un `apps/store/.env.local` (ignorado por git) con:

   ```dotenv
   API_MODE=live
   NEXT_PUBLIC_API_MODE=live
   API_BASE_URL=http://localhost:3001
   NEXT_PUBLIC_SITE_URL=http://localhost:4300
   REVALIDATE_SECRET=<32 caracteres o más>
   NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000
   ```

3. Desde `../frontend`, compilar y servir la tienda en otro puerto (el 3000 queda para el
   `next dev` de siempre; si la usás en el 3000, poné ahí `NEXT_PUBLIC_SITE_URL`):

   ```bash
   npm run build -w @galpon/store
   npx next start apps/store --port 4300
   ```

   `http://localhost:4300/` y `/tienda` tienen que mostrar los 27 productos del seed. Al terminar,
   cerrá `next start` y `npm run dev`, y `npm run db:down` si no vas a seguir.

Las escrituras (carrito, pedidos, pagos, cuenta, admin) llegan desde B3: hasta entonces, esas
pantallas de la tienda fallan en modo `live`. `POST /products/{slug}/reviews` llega en B7.

## Scripts

| Script                   | Qué hace                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| `npm run dev`            | Levanta la API en modo watch (`nest start --watch`), cargando `.env`.             |
| `npm run build`          | Compila a `dist/` con `tsconfig.build.json`.                                      |
| `npm start`              | Corre la versión compilada (`node dist/main`).                                    |
| `npm run typecheck`      | `tsc --noEmit` sobre `src/`, `test/`, `prisma/` y las configs.                    |
| `npm run lint`           | Verifica las versiones fijadas y corre ESLint (incluye las fronteras de capas).   |
| `npm run format`         | Formatea todo con Prettier.                                                       |
| `npm run format:check`   | Revisa el formato sin escribir.                                                   |
| `npm test`               | Unitarios (`src/**/*.spec.ts`) y el test de fronteras (`test/lint/`), sin Docker. |
| `npm run test:e2e`       | E2E (`test/**/*.e2e-spec.ts`, Testcontainers) y contrato (`test/contract/`).      |
| `npm run contract:check` | Solo el test de contrato, mostrando las operaciones pendientes.                   |
| `npm run db:up`          | `docker compose up -d --wait` (Postgres y Redis de desarrollo).                   |
| `npm run db:down`        | `docker compose down` (conserva los volúmenes).                                   |
| `npm run db:migrate`     | `prisma migrate dev`: aplica (y, si cambió el esquema, crea) migraciones.         |
| `npm run db:generate`    | Regenera el cliente de Prisma.                                                    |
| `npm run db:reset`       | Borra la base de desarrollo y vuelve a migrar (sin seed).                         |
| `npm run db:seed`        | Carga los datos del diseño (idempotente).                                         |

## Tests

- **Unitarios** (`npm test`): dominio y casos de uso con puertos en memoria, controladores por HTTP
  con queries en memoria, filtro de errores, idempotencia, caché, throttler, CORS y el test
  negativo de fronteras (escribe un `domain` que importa `@prisma/client` en
  `src/modules/_lint_probe/`, nombre reservado, corre ESLint y lo borra).
- **E2E** (`npm run test:e2e`): Postgres y Redis reales con Testcontainers (health, Prisma, seed,
  idempotencia, outbox, repositorio del catálogo y las 13 lecturas públicas), más el contrato.
  Corren de a un archivo.
- **Verificación completa**, la misma que corre la CI:

  ```bash
  npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e && npm run contract:check
  ```

## CI

`.github/workflows/ci.yml` (GitHub Actions, `ubuntu-latest`, Node 22): `npm ci`, typecheck, lint,
formato, unitarios, build, migraciones + seed dos veces contra los servicios `postgres:17` y
`redis:8`, E2E con Testcontainers y contrato. Clona el front al lado (`frontend/`, rama por
defecto de `LucasGonzalezRighi/Galp-nMatesE-comersFront-End`) para leer el `openapi.yaml`. Si ese
repo es privado, hay que cargar el secreto `FRONTEND_REPO_TOKEN` (token de solo lectura de ese
repo) en el repo del back.

## Calidad

- **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), sin
  `any` ni `!` de expresión. `strict` queda completo, con `strictPropertyInitialization` incluido:
  los DTOs de Nest declaran sus campos con inicializador o con `prop!: T` (asignación definida).
- **Fronteras hexagonales** con `eslint-plugin-boundaries` (spec §3.1, [ADR 0001](docs/adr/0001-nest-hexagonal-monolito.md)):
  `domain` no importa nada externo (solo `uuid`), `application` solo `domain`, `infrastructure`
  implementa los puertos e `interface` llama a `application` (y puede usar la infraestructura
  compartida de `src/shared/infrastructure`). Los `*.module.ts` quedan fuera de las capas y
  conectan puertos con adaptadores.
- **Errores** siempre `application/problem+json` (RFC 9457) con la forma `Problem` del contrato y
  `errors[]` por campo en los 422; textos en español.
- **Versiones exactas**, sin `^`: `scripts/dependency-versions.json` es la fuente única y
  `npm run lint` falla si `package.json` se aparta.
- **Hooks de git** (lefthook): antes de cada commit, Prettier y ESLint sobre lo staged.

## Estructura

```
src/
  main.ts, app.module.ts, app.setup.ts, swagger.ts
  config/                 variables de entorno validadas con zod (token ENV)
  shared/                 domain (Pesos, ids, errores), application (CachePort),
                          infrastructure (http, prisma, redis, throttler, idempotency, outbox, logger)
  modules/<módulo>/       domain / application / infrastructure / interface + <módulo>.module.ts
  generated/prisma/       cliente de Prisma (generado, no versionado)
prisma/                   schema.prisma, migraciones, seed.ts y seed-data/
test/                     e2e/, contract/, lint/ y support/
scripts/                  versiones fijadas, import de fixtures, diff de contrato
docs/                     BITACORA.md, adr/ y superpowers/ (spec y planes)
```

## Notas de versiones

- **Formato de módulos:** el paquete es CommonJS (sin `"type": "module"`). Nest 12 se publica como
  ESM y Node ≥ 22.12 lo carga con `require(esm)`. Por eso las configs de vitest son `.mts` (ESM
  explícito) y `eslint.config.js` usa `require`.
- **TypeScript 6.0.3** (la misma del front) compila con Nest 12 y `@nestjs/cli` 12.0.11.
- **Vitest 5 + `unplugin-swc` 2.0.0:** SWC compila los tests para que los decoradores emitan su
  metadata (el compilador por defecto de Vite no lo hace).
- **`@nest-lab/throttler-storage-redis` 1.2.0** declara Nest ≤ 11 como peer; `overrides` en
  `package.json` lo apunta al Nest 12 instalado.
- **Node:** `@nestjs/cli` trae `@angular-devkit` 22, que pide Node ≥ 22.22.3 y avisa `EBADENGINE`
  con versiones anteriores de Node 22; el build y el watch funcionan igual, pero conviene
  actualizar Node.
