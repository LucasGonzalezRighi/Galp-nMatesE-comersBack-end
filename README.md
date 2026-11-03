# Galpón Mates · backend

API de Galpón Mates: un monolito modular en **NestJS 12** con arquitectura hexagonal (cada módulo
en capas `domain / application / infrastructure / interface`), PostgreSQL con Prisma 7 y Redis.
La tienda y el admin del front la consumen en `http://localhost:3001/api/v1`.

- **Diseño:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](docs/superpowers/specs/2026-10-20-galpon-backend-design.md).
- **Bitácora** (qué se hizo en cada pieza, decisiones y versiones): [`docs/BITACORA.md`](docs/BITACORA.md).
- **Decisiones de arquitectura:** [ADR 0001 · monolito hexagonal](docs/adr/0001-nest-hexagonal-monolito.md),
  [ADR 0002 · Prisma 7 con `pg`](docs/adr/0002-prisma-7-driver-adapter-pg.md),
  [ADR 0003 · sesiones en Redis y CSRF por sesión](docs/adr/0003-sesiones-en-redis-y-csrf-por-sesion.md) y
  [ADR 0004 · reservas de stock y vencimiento](docs/adr/0004-reservas-de-stock-y-vencimiento.md).
- **Contrato (fuente de verdad):** vive en el repo del front, `../frontend/docs/api/openapi.yaml`.
  El back lo implementa; no se edita desde acá.

## Requisitos

- Node 22 (`.nvmrc`; mínimo 22.18) y npm 10.
- Docker Desktop abierto: Postgres y Redis de desarrollo y los E2E con Testcontainers.
- El repo del front clonado al lado, en `../frontend` (el test de contrato y el script que importa
  los datos del diseño lo leen de ahí).

## Puertos y orígenes

| Qué                    | Dónde                   | Notas                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Tienda (Next.js)       | `http://localhost:3000` | `STORE_ORIGIN`: arma el link de recuperación. Llega al back desde su servidor. |
| Admin (Vite)           | `http://localhost:5173` | `ADMIN_ORIGIN`. El único origen con CORS.                                      |
| Este back              | `http://localhost:3001` | `PORT`. Prefijo `/api/v1`; Swagger UI en `/api/docs`.                          |
| Postgres / Redis (dev) | `5432` / `6379`         | `docker compose` (`npm run db:up`).                                            |

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
  (5 destacadas), 7 contenidos, ajustes y 3 envíos, los mismos datos de las fixtures del front, y
  el admin semilla (ver "Cuenta y admin"). Es idempotente (`upsert` por `slug`/`key`; el admin
  solo se crea si falta): correrlo dos veces deja lo mismo.
- Los datos salen de `prisma/seed-data/`, que se regenera desde las fixtures del front con
  `node scripts/import-fixtures.mjs` (ver [`prisma/seed-data/README.md`](prisma/seed-data/README.md)).

## Contrato

`npm run contract:check` arma la app (sin Docker), genera el Swagger y lo compara, normalizado,
con `../frontend/docs/api/openapi.yaml` (o `CONTRACT_PATH`). Falla si una operación implementada
difiere del contrato o si Swagger expone una ruta que no está en `IMPLEMENTED_PATHS`
(`test/contract/openapi.contract.spec.ts`), y lista las operaciones pendientes (hoy, 36
implementadas y 41 pendientes de 77). Compara rutas, parámetros, respuestas, `security` y
`requestBody`. Además corre los casos compartidos de validación del front
(`../frontend/docs/api/validation-cases.json`) contra los DTOs de identidad y del checkout,
contacto y envío (`test/contract/validation-cases.contract.spec.ts`): las mismas entradas dan
los mismos errores en los dos lados.

Para ver las diferencias de una ruta: `node scripts/openapi-diff.mjs products/{slug}` (en Git Bash,
sin `/` inicial o entre comillas, para que no la convierta en una ruta de Windows).

## Probar la tienda contra este back

Las 13 lecturas públicas del contrato (`/categories`, `/products…`, `/reviews/featured`,
`/content/*`, `/settings/public`) están implementadas, sin límite de pedidos por IP (la tienda las
pide desde un solo servidor). Desde B3 funcionan la cuenta y el admin, y desde B4 el carrito, el
checkout hasta elegir el medio de pago y los pedidos (ver "Pedidos y stock"). Probadas contra
Postgres y Redis reales: los E2E con Testcontainers y esta misma prueba (ver "Verificación" de cada
pieza en [`docs/BITACORA.md`](docs/BITACORA.md)).

1. Acá, con Docker Desktop abierto: `npm run db:up`, `npm run db:migrate`, `npm run db:seed` y
   `npm run dev`. Si vas a probar la recuperación de contraseña desde la tienda compilada, arrancá
   el back con `STORE_ORIGIN=http://localhost:4300 npm run dev`: así el link del log apunta ahí.

2. Desde `../frontend`, compilar y servir la tienda en otro puerto, con el entorno exportado en
   esa terminal. El 3000 queda para el `next dev` de siempre, pero lanzalo desde otra terminal:
   los `export` quedan vivos en esta y un `next dev` lanzado acá también iría en modo `live`. No
   uses un `apps/store/.env.local`: el `next dev` también lo leería y quedaría en modo `live`.

   ```bash
   export API_MODE=live NEXT_PUBLIC_API_MODE=live API_BASE_URL=http://localhost:3001 \
     NEXT_PUBLIC_SITE_URL=http://localhost:4300 REVALIDATE_SECRET=<32 caracteres o más> \
     NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000
   npm run build -w @galpon/store
   cd apps/store && node ../../node_modules/next/dist/bin/next start --port 4300
   ```

   `http://localhost:4300/` y `/tienda` tienen que mostrar los 27 productos del seed. La cuenta
   (registro, ingreso, direcciones, recuperación) funciona contra el back, y también el carrito,
   el checkout hasta elegir el medio de pago (que crea el pedido y reserva el stock), el resultado
   sin pagar o vencido y "Mis pedidos". Al terminar, cerrá `next start` y `npm run dev`, y
   `npm run db:down` si no vas a seguir.

Qué falla todavía en modo `live`, y en qué pieza llega:

- **Pagos (B5):** "Pagar $… con Mercado Pago" da 404 en
  `POST /orders/{number}/payments/mercadopago/preference` y muestra "No pudimos iniciar el pago.
  Probá de nuevo.". Las rutas de la tarjeta (`…/mercadopago/card` e `installments`) tampoco
  existen todavía. El pedido queda en "Esperando el pago" hasta vencer.
- **Contacto, arrepentimiento y reseñas nuevas (B7).**

## Cuenta y admin

Desde B3 el back maneja las cuentas de la tienda y el ingreso al admin. Usa sesiones en Redis,
cookies `__Host-` y un token CSRF por sesión
([ADR 0003](docs/adr/0003-sesiones-en-redis-y-csrf-por-sesion.md)). Las 19 operaciones de
`/auth/*`, `/me*` y `/admin/auth/*` están implementadas (desde B4, `GET /me/orders` y
`GET /me/orders/{number}` viven en el módulo `orders`; ver "Pedidos y stock").

- **Cookies:** `__Host-galpon_session` (tienda: 30 días; la anónima que solo da el CSRF, 24 h) y
  `__Host-galpon_admin` (admin: 8 h). Duran un plazo fijo, que no se renueva con el uso.
  - Van siempre con `Path=/; HttpOnly; Secure; SameSite=Lax`, también en `http://localhost`.
  - **Probá con Chrome o Firefox:** aceptan cookies `Secure` en `localhost`. Safari no, y ahí la
    sesión no se guarda.
  - El token CSRF va en `X-CSRF-Token`. Si falta o no es el de la sesión, la respuesta es 403
    `csrf_invalid`, y el front pide uno nuevo.
- **Admin semilla:** `admin@galponmates.com.ar` / `galpon-demo-2026`, las credenciales del demo del
  front.
  - `npm run db:seed` lo crea solo si no existe y nunca lo pisa.
  - Para cambiar la contraseña: en el admin, "Mi cuenta" → "Cambiar contraseña"
    (`POST /admin/auth/password`).
  - Un nuevo seed no la restablece. Si la olvidás, `npm run db:reset && npm run db:seed` (borra la
    base de desarrollo).
  - En producción no puede quedar la contraseña pública (B8).
- **Recuperación de contraseña:** `POST /auth/password/forgot` responde siempre 202. Hasta B7 no
  hay proveedor de mail: fuera de producción, el back escribe el link en el log, en una línea con
  `"context":"LogMailer"` y el texto "Mail de recuperación de contraseña (solo log, sin proveedor)":

  ```text
  "link":"http://localhost:3000/cuenta/restablecer?token=rt_…"
  ```

  - El link sale de `STORE_ORIGIN`.
  - Vale 60 minutos y una sola vez.
  - Al usarlo se cierran todas las sesiones del usuario.
  - En producción el link no se loguea.

- **Límites:**
  - 20 pedidos por minuto por IP en registro, ingreso (cliente y admin), `forgot` y `reset`.
  - Tras 10 ingresos fallidos con el mismo email en 15 minutos, 429 con `Retry-After`. Durante esa
    espera tampoco entra la contraseña correcta.
  - Sin Redis, las rutas con sesión responden 503: ninguna deja pasar sin verificar.
- **Admin contra este back:** el back tiene que permitir el origen del admin en `ADMIN_ORIGIN`
  (`http://localhost:5173` con `vite dev`). Para el admin compilado, desde `../frontend`:

  ```bash
  export VITE_API_MODE=live VITE_API_BASE_URL=http://localhost:3001
  npm run build -w @galpon/admin
  cd apps/admin && npx vite preview --port 5273 --strictPort
  ```

  - El back va con `ADMIN_ORIGIN=http://localhost:5273`.
  - Los `export` quedan vivos en esa terminal: el `vite dev` del 5173 va desde otra, o también
    iría en modo `live`.
  - `VITE_API_BASE_URL` también tiene que estar al correr `vite preview`. La CSP del preview arma su
    `connect-src` al arrancar, y sin la variable el navegador bloquea las llamadas: el login muestra
    "No pudimos conectar, probá de nuevo".
  - Ingreso, recarga con la sesión y cierre de sesión funcionan, y "Mi cuenta" carga (el cambio de
    contraseña lo cubre el E2E).
  - Todas las pantallas con datos (Resumen, Pedidos, Productos, Líneas, Contenido, Reseñas,
    Mensajes y Ajustes) muestran "No pudimos cargar…": sus rutas `/admin/*` dan 404 hasta B6.

## Pedidos y stock

Desde B4 el módulo `orders` implementa las 6 operaciones del carrito y los pedidos:
`POST /cart/quote`, `POST /shipping/quote`, `POST /orders`, `GET /orders/{number}`,
`GET /me/orders` y `GET /me/orders/{number}`. El porqué del diseño está en el
[ADR 0004](docs/adr/0004-reservas-de-stock-y-vencimiento.md).

- **Cotización:** `POST /cart/quote` arma las líneas igual que el mock del front: claves de línea,
  detalle, kit con nombre `Kit` y su ahorro por unidad, y tope de 20 por producto sumando todas
  las líneas. No reserva nada. La tienda no usa `POST /shipping/quote`: el costo del envío sale de
  `/settings/public`.
- **Crear el pedido:** la tienda llama a `POST /orders` al elegir el medio de pago, con una
  `Idempotency-Key` (UUID v4).
  - No pide `X-CSRF-Token` (en el contrato la ruta es pública), pero lee la cookie de sesión si
    viene.
  - Con sesión de cliente, el pedido queda en esa cuenta. Sin sesión, se vincula al invitado con
    ese email (o se crea uno). Si el email es de una cuenta, el pedido queda sin dueño y solo se lee
    con su token.
  - Responde 201 con `{ order, orderToken }`. Los números arrancan en `GLP-10001`.
  - Si algo cambió desde la cotización responde 409 `stock_changed`, `price_changed` o
    `total_changed`, con un aviso por producto en `changes`, y la tienda muestra "Algo cambió en
    tu carrito".
  - Es la única ruta de pedidos con el límite global de 120 por minuto por IP. Las demás no tienen
    límite, porque toda la tienda llega desde la IP de su servidor.
- **Reserva de 30 minutos:** `reservedUntil` es `createdAt` + 30 minutos (una constante del
  contrato, no una variable de entorno). El stock queda en `inventory.reserved` y en una fila de
  `stock_reservations` por producto. El catálogo muestra como disponible `on_hand − reserved` (hasta
  20, en `maxQuantity`).
- **Vencimiento:** un pedido sin pago pasa a `expired` y devuelve el stock por el primero de tres
  caminos: el job `order.expire` de la cola `order-expiration` (corre en `reservedUntil`), el
  barrido de cada 60 s o la lectura (`GET /orders/{number}`, `GET /me/orders*`, y también
  `POST /cart/quote` y `POST /orders`). Los tres hacen lo mismo y liberan una sola vez. Un pago
  `pending` o `action_required` no vence (B5).
- **Leer un pedido:** `GET /orders/{number}` con `X-Order-Token` (`ot_` + 64 hex; la base guarda
  solo su SHA-256 y el log lo tapa) o con la sesión del dueño. Si no, 404 "No encontramos ese
  pedido.", sin distinguir por qué. `GET /me/orders` devuelve 10 por página, del más nuevo al más
  viejo.
- **Eventos:** `order.created` y `order.expired` quedan en el outbox, en la misma transacción.

Para ver el stock reservado y los últimos pedidos en el Postgres de compose (`-T` evita el error
de TTY de Git Bash):

```bash
docker compose exec -T postgres psql -U galpon -d galpon -c "SELECT p.slug, i.on_hand, i.reserved FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.reserved > 0"
docker compose exec -T postgres psql -U galpon -d galpon -c "SELECT number, status, payment_status, reserved_until FROM orders ORDER BY placed_at DESC LIMIT 10"
```

**Vencer un pedido a mano** para probar (sin esperar 30 minutos):

```bash
docker compose exec -T postgres psql -U galpon -d galpon -c "UPDATE orders SET reserved_until = now() - interval '1 second' WHERE number = '<número>'"
```

- Recargar `/checkout/resultado?pedido=<número>` en la pestaña de la compra lo vence en el acto
  y muestra "El pedido venció". Si nadie lo lee, el barrido lo vence en menos de un minuto (con el
  back andando).
- Usá un segundo y no un minuto: la fila `expired` del historial lleva la fecha de
  `reserved_until`, y si queda antes de `created_at` el historial sale desordenado.
- El job diferido sigue en la cola para la hora original. Cuando corre, no encuentra nada que
  vencer.

**Números de pedido:** salen de la secuencia `order_number_seq` de Postgres (de 10001 a 99999, sin
ciclo), como `GLP-` y cinco dígitos. Un 409 no gasta número (se pide después de reservar), pero un
fallo posterior sí, porque una secuencia no vuelve atrás. `npm run db:reset` la reinicia. Los
`GLP-09001…09012` quedan para la demo del admin (B6). El seed no siembra pedidos y nunca baja
`on_hand` por debajo de lo reservado: deja la fila como está y lo avisa.

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
- **E2E** (`npm run test:e2e`): Postgres y Redis reales con Testcontainers. Cubren health, Prisma,
  seed, idempotencia, outbox, el repositorio del catálogo y las 13 lecturas públicas. Desde B3
  suman sesiones en Redis, los adaptadores de identidad y la autenticación completa por HTTP
  (cookies, CSRF, rotación, bloqueo, recuperación y admin). Desde B4, el repositorio de pedidos
  con la reserva atómica, la cola y el barrido de vencimiento, y los pedidos por HTTP (doble envío,
  10 compras simultáneas sobre 5 unidades, vencimiento al leer y dueño correcto). Incluyen también
  el contrato y los casos compartidos de validación. Corren de a un archivo.
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
