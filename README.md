# Galpón Mates · backend

API de Galpón Mates: un monolito modular en **NestJS 12** con arquitectura hexagonal (cada módulo
en capas `domain / application / infrastructure / interface`), PostgreSQL con Prisma y Redis. La
tienda y el admin del front la consumen en `http://localhost:3001/api/v1`.

- **Diseño:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](docs/superpowers/specs/2026-10-20-galpon-backend-design.md).
- **Contrato (fuente de verdad):** vive en el repo del front, `../frontend/docs/api/openapi.yaml`.
  El back lo implementa; no se edita desde acá.

## Requisitos

- Node 22 (`.nvmrc`; mínimo 22.18) y npm 10.
- Docker Desktop abierto: Postgres y Redis de desarrollo y los E2E con Testcontainers.

## Puesta en marcha

```bash
npm install   # también instala los hooks de git (lefthook)
npm run dev   # nest start --watch en http://localhost:3001
```

El puerto es `3001` (variable `PORT`). Todas las rutas llevan el prefijo `/api/v1`; por ejemplo,
`GET http://localhost:3001/api/v1/health`.

## Probar la tienda contra este back

Las 13 lecturas públicas del contrato (`/categories`, `/products…`, `/reviews/featured`,
`/content/*`, `/settings/public`) están implementadas y sus tests con queries en memoria pasan; los
E2E contra Postgres y esta prueba con la tienda todavía no se corrieron (Docker Desktop no
arrancaba: ver el reporte de la Task 9). Las lecturas no tienen límite de pedidos por IP (la tienda
las pide desde un solo servidor). Para ver la tienda del front con estos datos:

1. Acá, con Docker Desktop abierto:

   ```bash
   npm run db:up   # docker compose up -d --wait
   npm run db:migrate && npm run db:seed
   npm run dev   # http://localhost:3001/api/v1
   ```

2. En el front (`../frontend`), un `apps/store/.env.local` (está ignorado por git) con:

   ```dotenv
   API_MODE=live
   NEXT_PUBLIC_API_MODE=live
   API_BASE_URL=http://localhost:3001
   REVALIDATE_SECRET=<32 caracteres o más>
   NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000
   ```

3. Desde `../frontend`, compilar y servir la tienda en otro puerto (el 3000 queda para el
   `next dev` de siempre):

   ```bash
   npm run build -w @galpon/store
   npx next start apps/store --port 4300
   ```

   `http://localhost:4300/` y `/tienda` tienen que mostrar los 27 productos del seed. Al terminar,
   cerrá `next start` y `npm run dev`, y `npm run db:down` si no vas a seguir.

Las escrituras (carrito, pedidos, pagos, cuenta, admin) llegan en B3 en adelante: hasta entonces,
esas pantallas de la tienda fallan en modo `live`. `POST /products/{slug}/reviews` llega en B7.

## Scripts

| Script                 | Qué hace                                                                        |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`          | Levanta la API en modo watch (`nest start --watch`).                            |
| `npm run build`        | Compila a `dist/` con `tsconfig.build.json`.                                    |
| `npm start`            | Corre la versión compilada (`node dist/main`).                                  |
| `npm run typecheck`    | `tsc --noEmit` sobre `src/`, `test/`, `prisma/` y las configs.                  |
| `npm run lint`         | Verifica las versiones fijadas y corre ESLint (incluye las fronteras de capas). |
| `npm run format`       | Formatea todo con Prettier.                                                     |
| `npm run format:check` | Revisa el formato sin escribir.                                                 |
| `npm test`             | Tests unitarios (`src/**/*.spec.ts`) con vitest.                                |
| `npm run test:e2e`     | E2E (`test/**/*.e2e-spec.ts`) y contrato (`test/contract/**/*.spec.ts`).        |

## Calidad

- **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), sin
  `any` ni `!` de expresión. `strict` queda completo, con `strictPropertyInitialization` incluido:
  los DTOs de Nest declaran sus campos con inicializador o con `prop!: T` (asignación definida).
- **Fronteras hexagonales** con `eslint-plugin-boundaries` (spec §3.1): `domain` no importa nada
  externo (solo `uuid`), `application` solo `domain`, `infrastructure` implementa los puertos e
  `interface` llama a `application` (y puede usar la infraestructura compartida de
  `src/shared/infrastructure`). Los `*.module.ts` quedan fuera de las capas y conectan puertos con
  adaptadores.
- **Versiones exactas**, sin `^`: `scripts/dependency-versions.json` es la fuente única y
  `npm run lint` falla si `package.json` se aparta.
- **Hooks de git** (lefthook): antes de cada commit, Prettier y ESLint sobre lo staged.

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
