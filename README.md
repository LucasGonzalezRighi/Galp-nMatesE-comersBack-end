# Galpón Mates · backend

API de Galpón Mates: un monolito modular en **NestJS 12** con arquitectura hexagonal (cada módulo
en capas `domain / application / infrastructure / interface`), PostgreSQL con Prisma 7 y Redis.
La tienda y el admin del front la consumen en `http://localhost:3001/api/v1`.

- **Diseño:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](docs/superpowers/specs/2026-10-20-galpon-backend-design.md).
- **Bitácora** (qué se hizo en cada pieza, decisiones y versiones): [`docs/BITACORA.md`](docs/BITACORA.md).
- **Decisiones de arquitectura:** [ADR 0001 · monolito hexagonal](docs/adr/0001-nest-hexagonal-monolito.md),
  [ADR 0002 · Prisma 7 con `pg`](docs/adr/0002-prisma-7-driver-adapter-pg.md),
  [ADR 0003 · sesiones en Redis y CSRF por sesión](docs/adr/0003-sesiones-en-redis-y-csrf-por-sesion.md),
  [ADR 0004 · reservas de stock y vencimiento](docs/adr/0004-reservas-de-stock-y-vencimiento.md),
  [ADR 0005 · pagos con Mercado Pago](docs/adr/0005-pagos-con-mercado-pago.md) y
  [ADR 0006 · combos y aviso a la tienda](docs/adr/0006-combos-y-aviso-a-la-tienda.md).
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
| Tienda (Next.js)       | `http://localhost:3000` | `STORE_ORIGIN`: link de recuperación y vuelta del pago. Llega desde su server. |
| Admin (Vite)           | `http://localhost:5173` | `ADMIN_ORIGIN`. El único origen con CORS.                                      |
| Este back              | `http://localhost:3001` | `PORT`. Prefijo `/api/v1`; Swagger UI en `/api/docs`.                          |
| Postgres / Redis (dev) | `5432` / `6379`         | `docker compose` (`npm run db:up`).                                            |

**CORS:** solo `ADMIN_ORIGIN` (en desarrollo `http://localhost:5173`) recibe permiso, con
credenciales (las cookies de sesión del admin). La tienda no lo necesita: su servidor llama al back
y reescribe `/api/v1/*` hacia él, así que el navegador siempre habla con la tienda. Un pedido desde
otro origen no recibe cabeceras CORS y el navegador lo bloquea.

**Aviso a la tienda:** cada guardado de combos del dashboard le pide a la tienda (en `STORE_ORIGIN`)
que regenere la etiqueta `combos`, con el secreto `STORE_REVALIDATE_SECRET`. La variable, el detalle
y la prueba en vivo están en "Combos y aviso a la tienda".

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
- **Seed** (`npm run db:seed` o `npx prisma db seed`): 6 líneas, 27 productos, 18 reseñas
  (10 destacadas), 7 contenidos, 5 combos (4 publicados), ajustes y 3 envíos, los mismos datos de
  las fixtures del front, y el admin semilla (ver "Cuenta y admin"). Es idempotente (`upsert` por
  `slug`/`key`; el admin solo se crea si falta): correrlo dos veces deja lo mismo.
  - Los combos se guardan con un UUID v5 de su clave del mock: un seed nuevo les devuelve el
    nombre, el precio, el estado, la posición y las piezas de las fixtures. Los combos creados desde
    el dashboard no los toca.
- Los datos salen de `prisma/seed-data/`, que se regenera desde las fixtures del front con
  `node scripts/import-fixtures.mjs` (ver [`prisma/seed-data/README.md`](prisma/seed-data/README.md)).

## Contrato

`npm run contract:check` arma la app (sin Docker), genera el Swagger y lo compara, normalizado,
con `../frontend/docs/api/openapi.yaml` (o `CONTRACT_PATH`). Falla si una operación implementada
difiere del contrato o si Swagger expone una ruta que no está en `IMPLEMENTED_PATHS`
(`test/contract/openapi.contract.spec.ts`), y lista las operaciones pendientes (hoy, 47
implementadas y 36 pendientes de 83). Compara rutas, parámetros, respuestas, `security` y
`requestBody`. Además corre los casos compartidos de validación del front
(`validation-cases.json`, al lado del `openapi.yaml`) contra los DTOs de identidad, del checkout
(contacto y envío), del documento de quien paga con tarjeta y de los combos del dashboard (alta,
edición y orden) (`test/contract/validation-cases.contract.spec.ts`): las mismas entradas dan los
mismos errores en los dos lados.

- **Otro contrato:** `CONTRACT_PATH` apunta a otro `openapi.yaml` (los casos de validación se
  leen del `validation-cases.json` de esa misma carpeta). Sirve para probar el back contra una
  rama del front que todavía no está en `main`, por ejemplo desde un worktree:
  `CONTRACT_PATH="../frontend-inicio-combos/docs/api/openapi.yaml" npm run contract:check`. Así
  se construyó B5c, antes de que el front mergeara los combos.
- **Combos y la CI:** el `main` local del front ya tiene los combos (`063c091`), así que
  `npm run contract:check` pasa sin `CONTRACT_PATH`. La CI clona el `main` **remoto** del front:
  hasta que ese `main` tenga los combos, el contrato de la CI falla (por ejemplo, no encuentra los
  casos de validación de combos). Por eso se pushea primero el `main` del front y después el del
  back.

Para ver las diferencias de una ruta: `node scripts/openapi-diff.mjs products/{slug}` (en Git Bash,
sin `/` inicial o entre comillas, para que no la convierta en una ruta de Windows).

## Probar la tienda contra este back

Las 13 lecturas públicas del contrato (`/categories`, `/products…`, `/reviews/featured`,
`/content/*`, `/settings/public`) están implementadas, sin límite de pedidos por IP (la tienda las
pide desde un solo servidor). Desde B3 funcionan la cuenta y el admin, desde B4 el carrito, el
checkout y los pedidos (ver "Pedidos y stock"), y desde B5 el pago con Mercado Pago contra el
simulador del back (ver "Pagos con Mercado Pago"). Probadas contra Postgres y Redis reales: los
E2E con Testcontainers y esta misma prueba (ver "Verificación" de cada pieza en
[`docs/BITACORA.md`](docs/BITACORA.md)).

1. Acá, con Docker Desktop abierto: `npm run db:up`, `npm run db:migrate`, `npm run db:seed` y
   `STORE_ORIGIN=http://localhost:4300 npm run dev`. `STORE_ORIGIN` tiene que ser el origen de la
   tienda compilada: ahí vuelve el comprador después del simulador de Mercado Pago, y ahí apunta
   el link de recuperación de contraseña del log.

2. Desde `../frontend`, con el back andando (el build lee el catálogo y falla con
   `Failed to collect page data` si no lo encuentra), compilar y servir la tienda en otro puerto,
   con el entorno exportado en esa terminal. El 3000 queda para el `next dev` de siempre, pero
   lanzalo desde otra terminal: los `export` quedan vivos en esta y un `next dev` lanzado acá
   también iría en modo `live`. No uses un `apps/store/.env.local`: el `next dev` también lo leería
   y quedaría en modo `live`.

   ```bash
   export API_MODE=live NEXT_PUBLIC_API_MODE=live API_BASE_URL=http://localhost:3001 \
     NEXT_PUBLIC_SITE_URL=http://localhost:4300 REVALIDATE_SECRET=<32 caracteres o más> \
     NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000
   npm run build -w @galpon/store
   cd apps/store && node ../../node_modules/next/dist/bin/next start --port 4300
   ```

   `http://localhost:4300/` y `/tienda` tienen que mostrar los 27 productos del seed. La cuenta
   (registro, ingreso, direcciones, recuperación) funciona contra el back, y también el carrito,
   el checkout (que crea el pedido y reserva el stock), el pago con Mercado Pago (la página del
   simulador del back: Aprobar, Dejar pendiente o Rechazar), el resultado de cada caso y "Mis
   pedidos". Al terminar, cerrá `next start` y `npm run dev`, y `npm run db:down` si no vas a
   seguir.

Qué falla todavía en modo `live`, y en qué pieza llega:

- **Contacto, arrepentimiento y reseñas nuevas (B7).**

El pago con tarjeta dentro de la tienda no es una falla del back, pero en local no se completa. Con
la clave pública de mentira, los Secure Fields reales cargan, pero Mercado Pago no reconoce la
tarjeta y el pedido nunca llega al back (detalle en "Pagos con Mercado Pago"). Se prueba con el
sandbox o por API.

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
  - Desde B5c, **Combos** funciona contra el back (ver "Combos y aviso a la tienda"). Las demás
    pantallas con datos (Resumen, Pedidos, Productos, Líneas, Contenido, Reseñas, Mensajes y
    Ajustes) muestran "No pudimos cargar…": sus rutas `/admin/*` dan 404 hasta B6.

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
  `pending` o `action_required` no vence: lo concilia B5 (ver "Pagos con Mercado Pago").
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

## Pagos con Mercado Pago

Desde B5 el módulo `payments` cobra con Mercado Pago. Sin credenciales todo corre con el
simulador del back (`MP_MODE=simulated`, el valor por defecto): así corren los E2E, el contrato y
el desarrollo local. Las variables (detalle en `.env.example`):

| Variable                  | Por defecto    | Notas                                                                              |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `MP_MODE`                 | `simulated`    | `simulated` o `live`. Con `NODE_ENV=production` tiene que ser `live`.              |
| `MP_ACCESS_TOKEN`         | (sin valor)    | Access token de Mercado Pago. Obligatorio con `live`; nunca se loguea.             |
| `MP_WEBHOOK_SECRET`       | (sin valor)    | Clave secreta de las notificaciones (firma `x-signature`). Obligatoria con `live`. |
| `PUBLIC_API_ORIGIN`       | (sin valor)    | Origen público HTTPS del back, sin ruta. Obligatorio con `live`.                   |
| `MP_STATEMENT_DESCRIPTOR` | `GALPON MATES` | Texto del resumen de la tarjeta (hasta 13 caracteres).                             |

Si con `MP_MODE=live` falta alguna de las tres, la API no arranca y el error lo dice. Una
variable definida pero vacía (`MP_ACCESS_TOKEN=`) también es un error: comentala en el `.env`.
La clave pública (`NEXT_PUBLIC_MP_PUBLIC_KEY`) va en la tienda, no en el back. El porqué del
diseño está en el [ADR 0005](docs/adr/0005-pagos-con-mercado-pago.md).

### Cómo cobra

Son cinco operaciones del contrato. Las cuatro rutas de pago aceptan
solo el `X-Order-Token` del pedido: sin token, con un token ajeno o con un pedido inexistente
responden el mismo 404, y no usan la sesión ni `X-CSRF-Token`.

- **Checkout Pro:** `POST /orders/{number}/payments/mercadopago/preference` (con
  `Idempotency-Key`) devuelve `initPoint`.
  - La tienda manda al comprador ahí, y Mercado Pago lo devuelve a
    `${STORE_ORIGIN}/checkout/resultado?pedido=<número>`.
  - El pedido se paga recién cuando el back lee el pago aprobado: por la notificación, el
    simulador o la conciliación. Nunca por los parámetros de la vuelta.
- **Tarjeta:** `POST …/mercadopago/card` (con `Idempotency-Key`) cobra con el token de los Secure
  Fields y aplica la respuesta en la misma llamada.
  - Un pago aprobado deja el pedido pagado al instante.
  - Con 3-D Secure responde `action_required` y `challenge.url`, y la tienda abre ese desafío en
    un `iframe`.
- **Cuotas:** `POST …/installments` con `bin` y `paymentTypeId`. Con débito, solo 1 pago.
- **Cancelar:** `POST /orders/{number}/cancel-payment` cancela el intento en curso (también en
  Mercado Pago) y responde 204 siempre. El pedido queda vencible y conserva su reserva.
- **Webhook:** `POST /webhooks/mercadopago` valida `x-signature`, registra el aviso una sola vez,
  lo procesa en la cola `payment-webhooks` y responde 200 (401 con la firma mal o sin
  `MP_WEBHOOK_SECRET`).

Hay un solo intento activo por pedido: empezar otro cancela el anterior. Cuando el pago se aprueba:

- El pedido pasa a `paid`.
- Las reservas pasan a `committed` e `inventory` descuenta `on_hand` y `reserved`.
- El outbox suma `payment.approved` y `order.paid`.

Un segundo pago aprobado sobre un pedido ya pagado, o uno que llega para un pedido vencido, se
devuelve solo y queda en `refunds`. El barrido de cada 60 s concilia los pagos en curso: 10
minutos después de `reserved_until` consulta el pago a Mercado Pago, y a las 48 h, si sigue
pendiente, lo cancela y el pedido vence.

Para ver los intentos y las devoluciones en el Postgres de compose:

```bash
docker compose exec -T postgres psql -U galpon -d galpon -c "SELECT o.number, o.status, o.payment_status, p.method, p.status, p.status_detail, p.is_active FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY p.created_at DESC LIMIT 10"
docker compose exec -T postgres psql -U galpon -d galpon -c "SELECT reason, status, amount_ars, last_error FROM refunds ORDER BY created_at DESC LIMIT 10"
```

### Modo simulado

Con `MP_MODE=simulated` (y fuera de `production`), el back hace de Mercado Pago:

- **Checkout Pro:** el `initPoint` es una página del back,
  `http://localhost:3001/api/v1/__simulated/mercadopago/checkout?preference=sim-pref-…` (o la de
  `PUBLIC_API_ORIGIN`), con el pedido, el total y tres botones:
  - **Aprobar:** `approved`/`accredited`.
  - **Dejar pendiente:** `pending`/`pending_waiting_payment`.
  - **Rechazar:** `rejected`/`cc_rejected_other_reason`.

  Cada botón aplica el resultado como si fuera la notificación y vuelve a la tienda con un 302 a
  `STORE_ORIGIN`.

- **Tarjeta:** el token simulado es `sim_<TITULAR>_<últimos 4|xxxx>_<32 hex>`, el mismo formato que
  los campos simulados de la tienda en modo `mock`. Otro token da 422 en `token`.

  | Titular | Resultado                                                                       |
  | ------- | ------------------------------------------------------------------------------- |
  | `APRO`  | `approved` / `accredited`: pedido pagado                                        |
  | `CONT`  | `pending` / `pending_contingency`                                               |
  | `OTHE`  | `rejected` / `cc_rejected_other_reason` (también cualquier titular desconocido) |
  | `FUND`  | `rejected` / `cc_rejected_insufficient_amount`                                  |
  | `SECU`  | `rejected` / `cc_rejected_bad_filled_security_code`                             |
  | `EXPI`  | `rejected` / `cc_rejected_bad_filled_date`                                      |
  | `CALL`  | `rejected` / `cc_rejected_call_for_authorize`                                   |
  | `3DS`   | `action_required`, con el desafío del back en `challenge.url`                   |

  El desafío (`…/__simulated/mercadopago/challenge?payment=…`) tiene **Confirmar** (aprueba) y
  **Cancelar** (rechaza con `cc_rejected_3ds_challenge`).

- **Cuotas:** de 1 a `installmentsMax` de los ajustes (3 en el seed) sin interés, y 6 y 12 con
  CFT 45,90 % y TEA 38 %, sobre el total del pedido. Otra cantidad da 422 en `installments`.

**La compra completa desde la tienda compilada** (ver "Probar la tienda contra este back"):
carrito → checkout → "Mercado Pago" → "Pagar $… con Mercado Pago" → página del simulador → Aprobar
→ "¡Gracias, …!" y el pedido "Pagado" en "Mis pedidos". Rechazar muestra "El pago no se aprobó",
y Dejar pendiente muestra "Estamos esperando la confirmación del pago".

Lo que en local no se ve desde la tienda:

- **El formulario de tarjeta en modo `live` usa los Secure Fields reales.** Con la clave pública de
  mentira, los campos cargan, pero `GET /v1/payment_methods/search` de Mercado Pago responde 404:
  la tienda marca "Número incompleto", no muestra cuotas y no llama al back.
- **El desafío 3DS simulado:** su URL es `http://`, y la tienda solo acepta un `challenge.url`
  `https:` o una ruta propia (su CSP solo enmarca `https:`). Muestra "Falta verificar la compra con
  tu banco" con "Pagar de nuevo". El desafío se puede abrir en otra pestaña: al confirmarlo, el
  resultado pasa a aprobado.

Para probar la tarjeta simulada por API, tomá el número y el `orderToken` de la pestaña de la
compra (en la consola: `JSON.parse(sessionStorage['galpon.order'])`):

```bash
curl -s http://localhost:3001/api/v1/orders/<número>/payments/mercadopago/card \
  -H "Content-Type: application/json" -H "X-Order-Token: <orderToken>" \
  -H "Idempotency-Key: $(node -e "console.log(crypto.randomUUID())")" \
  -d '{"token":"sim_APRO_3704_0123456789abcdef0123456789abcdef","paymentMethodId":"visa","issuerId":null,"installments":1,"payer":{"email":"<email del pedido>","identification":{"type":"DNI","number":"12345678"}}}'
```

En `simulated` el webhook responde 401 mientras no haya `MP_WEBHOOK_SECRET`. Para probar la firma
a mano, definí uno en el `.env` y firmá como `signWebhook` de `test/support/payments.ts`.

### Sandbox de Mercado Pago: qué tiene que pasar Lucas

Todo lo de arriba corre sin credenciales. Para la prueba contra el sandbox real (spec §11: "B5
listo cuando: compra completa con el sandbox de MP") hace falta, de la **misma aplicación** del
panel de Mercado Pago (Tus integraciones → la aplicación → Credenciales de prueba):

1. **Public key de prueba:** va en la tienda, `NEXT_PUBLIC_MP_PUBLIC_KEY`.
2. **Access token de prueba:** va en el back, `MP_ACCESS_TOKEN`. Hoy empieza con `APP_USR-`, igual
   que el productivo, así que no se distinguen por el prefijo.
3. **Clave secreta de webhooks** (Webhooks → Configurar notificaciones → Guardar la genera): va en
   `MP_WEBHOOK_SECRET`.
4. **Un origen público HTTPS que llegue a este back** (un túnel como cloudflared, ngrok o
   similar): va en `PUBLIC_API_ORIGIN`. En el panel, la URL de "Modo pruebas" es
   `${PUBLIC_API_ORIGIN}/api/v1/webhooks/mercadopago`, con el evento "Pagos". El back además
   manda esa `notification_url` en cada preferencia y pago, y esa tiene prioridad.
5. **Otro origen público HTTPS, ahora hacia la tienda** (otro túnel, al puerto donde corra la
   tienda compilada): va en `STORE_ORIGIN`. Checkout Pro es el único flujo que lo necesita así: el
   back manda `back_urls` (success, pending y failure) con `${STORE_ORIGIN}/checkout/resultado` y
   `auto_return: approved`, y Mercado Pago descarta las `back_urls` que no son HTTPS públicas (nada
   de `localhost`) y exige `back_urls.success` para el `auto_return`. Con el `STORE_ORIGIN` por
   defecto (`http://localhost:3000`) la preferencia probablemente se rechaza con 400, que la tienda
   ve como 502. El pago con tarjeta no lo usa.
6. **La cuenta compradora de prueba** (usuario, contraseña y el código de 6 dígitos): Checkout Pro
   exige comprar logueado con ella, en una ventana de incógnito.
7. Opcional: el User ID de la cuenta vendedora, que llega en cada notificación.

Con eso, el `.env` del back lleva `MP_MODE=live`, las tres variables y `STORE_ORIGIN` (adonde
vuelve el comprador, con el origen HTTPS público del paso 5). La tienda se compila con su public
key. Las tarjetas de prueba de Argentina son la Visa `4509 9535 6623 3704` y la Mastercard
`5031 7557 3453 0604`, con CVV `123`, vencimiento `11/30` y DNI `12345678`. El nombre del titular elige el resultado (`APRO`, `OTHE`, `CONT`, `FUND`,
…). Para 3DS: `5483 9281 6457 4623` (desafío exitoso) y `5361 9568 0611 7557` (no autorizado).

**E2E del sandbox** (`test/e2e/mercadopago.sandbox.e2e-spec.ts`): se omite sin `MP_ACCESS_TOKEN`
y no necesita Docker. Crea una preferencia real y la vence, cobra la Visa `APRO` y la vuelve a
leer, y pide cuotas:

```bash
MP_ACCESS_TOKEN=APP_USR-… MP_PUBLIC_KEY=APP_USR-… MP_TEST_PAYER_EMAIL=test_user_…@testuser.com \
  npx vitest run -c vitest.e2e.config.mts test/e2e/mercadopago.sandbox.e2e-spec.ts
```

`MP_PUBLIC_KEY` (la misma public key de la tienda) se usa para tokenizar la Visa: pasala siempre,
porque sin ella el test pide el token con el access token y Mercado Pago probablemente lo rechace.
`MP_TEST_PAYER_EMAIL` es opcional: tiene que ser distinto del email de la cuenta vendedora.

**La trampa de las notificaciones de prueba:** la documentación de Mercado Pago avisa que **los
pagos hechos con credenciales de prueba pueden no mandar notificaciones**. Si no llegan:

- **Tarjeta:** no depende del aviso. La respuesta inmediata ya deja el pedido pagado o rechazado, y
  un pago pendiente lo consulta la conciliación a los 10 minutos de `reserved_until`.
- **Checkout Pro:** sí depende del aviso. Sin ninguna notificación, el intento queda en `none` (no
  tiene id de pago que consultar) y el pedido vence a los 30 minutos. Para probarlo, usá el
  **simulador de notificaciones del panel** (Webhooks → Simular, tipo "Pagos", con el id del pago
  real que muestra la actividad de la cuenta de prueba). El aviso llega firmado con la clave, el
  back lo consulta y lo aplica.
- Un aviso del panel con un id que no existe responde 200 igual: el evento queda procesado, con el
  error en `webhook_events.last_error`.

Qué falta confirmar con el sandbox:

- El `status_detail` real de cada titular (el simulador sigue la tabla que se infiere de la
  documentación).
- Qué responde Mercado Pago a unas `back_urls` que no son HTTPS públicas: la documentación dice que
  las descarta y que `auto_return` exige `back_urls.success`, pero no si la preferencia falla con
  400 (`invalid_back_urls`) o se crea sin la vuelta automática. Con el `STORE_ORIGIN` del paso 5
  no hace falta saberlo.
- El desafío 3DS real: Mercado Pago pide un `POST` del `creq` a `external_resource_url`, y el
  contrato solo lleva `challenge.url`.

## Combos y aviso a la tienda

Desde B5c el back tiene los combos del contrato: 2 o 3 productos fijos, de grupos distintos, con un
precio final menor que la suma de las piezas. Viven en el módulo `catalog`, sin caché de Redis
([ADR 0006](docs/adr/0006-combos-y-aviso-a-la-tienda.md)).

| Ruta                        | Quién                  | Qué hace                                                                                      |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `GET /combos`               | Tienda, sin sesión     | Los publicados con todas sus piezas publicadas y con precio, por posición (agotados también). |
| `GET /admin/combos`         | Admin                  | Todos, por posición, con `isPurchasable` y los derivados.                                     |
| `POST /admin/combos`        | Admin + `X-CSRF-Token` | Alta al final de la lista (201).                                                              |
| `PATCH /admin/combos/{id}`  | Admin + `X-CSRF-Token` | Reemplaza todo y conserva la posición (200).                                                  |
| `DELETE /admin/combos/{id}` | Admin + `X-CSRF-Token` | Borra y renumera 1..n (204). Los pedidos guardan su copia.                                    |
| `PUT /admin/combos/order`   | Admin + `X-CSRF-Token` | Nuevo orden; tiene que traer todos los combos, una vez cada uno (204).                        |

- **Reglas del dashboard** (las del mock, en el mismo orden): primero el cuerpo, con los mensajes
  del formulario del front; después, cada pieza que no está publicada o no tiene precio
  (`productIds.N`, `product_unavailable`); y solo si todas sirven, piezas de grupos repetidos
  (`duplicate_group`) y un precio que no es menor que la suma (`price_not_below_sum`, también en
  borradores). Un id que no existe o no es un UUID da 404 "No existe ese combo.".
- **En el carrito y el pedido** el combo es una línea `type: 'combo'` con `comboId`, la cantidad y,
  si lleva mate, el cuero y la virola. Se cobra el precio del combo, con el ahorro contra la suma
  de las piezas. El stock de cada pieza se comparte con las otras líneas y la reserva suma cada
  pieza. Un combo borrado, en borrador o con una pieza que ya no se vende da `unavailable` en la
  cotización y 409 `stock_changed` al crear el pedido. La línea guardada es una copia, sin
  `combo_id`: `kitItems` trae las piezas en el orden del combo.
- **Aviso a la tienda:** cada alta, edición, borrado u orden agrega `combo.changed` al outbox en la
  misma transacción. El relay lo publica (hasta unos 2 s) y `storefront-sync` hace
  `POST ${STORE_ORIGIN}/api/revalidate` con `x-revalidate-secret` y `{"tags":["combos"]}`. En el log
  del back queda `La tienda regeneró combos (evento combo.changed)` (contexto
  `StorefrontRevalidateProcessor`).
  - Un 4xx del dashboard (validación, 404, CSRF) no avisa nada.
  - Con la tienda caída o respondiendo 5xx, la cola `storefront-revalidate` hace 8 intentos en
    total (unos 2 minutos). Con 401 (secreto distinto) o 422 (etiqueta que la tienda no conoce) no
    reintenta, y el back lo avisa en el log. La escritura del dashboard nunca falla por la tienda.
  - Sin `STORE_REVALIDATE_SECRET` no se avisa nada (un aviso al arrancar) y la tienda se pone al
    día cuando vence su caché (`cacheLife('hours')`). Por eso el `.env` de desarrollo no lo trae:
    el `next dev` del 3000 está en modo de prueba y respondería 401.

| Variable                  | Por defecto | Notas                                                                                                                                                                         |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORE_REVALIDATE_SECRET` | (sin valor) | El mismo `REVALIDATE_SECRET` de la tienda (32 caracteres o más). Obligatorio en `production`; sin él no se le avisa nada y la tienda se regenera por tiempo. Nunca se loguea. |

**Probarlo en vivo** (así se probó B5c; las dos apps salen del mismo commit del front y van en
puertos propios, sin tocar el `next dev` del 3000 ni el `vite dev` del 5173):

1. Un secreto de 32 caracteres o más, el mismo para los dos lados (no se commitea ni se pega en
   ningún lado):
   `SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`.
2. Acá: `npm run db:up`, `npm run db:migrate`, `npm run db:seed`, `npm run build` y

   ```bash
   STORE_ORIGIN=http://localhost:4320 ADMIN_ORIGIN=http://localhost:5320 MP_MODE=simulated \
     STORE_REVALIDATE_SECRET=$SECRET npm start
   ```

3. Desde el front, con el back andando y el entorno en la misma línea (sin `.env.local`):

   ```bash
   API_MODE=live NEXT_PUBLIC_API_MODE=live API_BASE_URL=http://localhost:3001 \
     NEXT_PUBLIC_SITE_URL=http://localhost:4320 REVALIDATE_SECRET=$SECRET \
     NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-00000000-0000-0000-0000-000000000000 \
     npm run build -w @galpon/store
   # después, con el mismo entorno y desde apps/store:
   # node ../../node_modules/next/dist/bin/next start --port 4320

   VITE_API_MODE=live VITE_API_BASE_URL=http://localhost:3001 VITE_STORE_URL=http://localhost:4320 \
     npm run build -w @galpon/admin
   # después, con el mismo entorno (sin VITE_API_BASE_URL la CSP bloquea el back), desde apps/admin:
   # npx vite preview --port 5320 --strictPort
   ```

4. Chequeo de la tienda sola:
   `curl -s -X POST http://localhost:4320/api/revalidate -H "x-revalidate-secret: $SECRET" -H 'content-type: application/json' -d '{"tags":["combos"]}'`
   tiene que dar `{"revalidated":["combos"]}`.
5. En `http://localhost:5320`, entrar con el admin semilla, ir a **Combos**, "Acciones de …" →
   Editar, cambiar el precio y Guardar ("Cambios guardados."). La recarga siguiente del inicio de
   `http://localhost:4320` ya muestra el precio nuevo (la tienda sirve lo anterior mientras se
   regenera: si no se ve en la primera, en la segunda sí). "Subir" o "Bajar" un combo cambia el
   orden del inicio igual.
6. Al terminar: cerrar `next start`, `vite preview` y `npm start`, y `npm run db:down`.

Hasta B6 el diálogo de un combo muestra "No pudimos cargar los productos." en las piezas:
las lista con `GET /admin/products`, que todavía da 404. El nombre, la descripción, el precio y el
estado se guardan igual, pero un combo nuevo o un cambio de piezas desde el dashboard espera a B6
(por API funcionan).

## Fotos (Cloudinary)

Desde B6 las fotos del dashboard (socios de Nosotros y, después, productos y líneas) se guardan
sin llamar a la Admin API de Cloudinary: una foto se acepta si su `publicId` está en la carpeta de
su uso (`galpon/productos/`, `galpon/lineas/`, `galpon/socios/`, `galpon/sitio/`) o si es la que
el recurso ya tiene, y la `url` se arma con la nube. Si no, 422 `unknown_image` "La foto no
existe: subila de nuevo". Las variables (detalle en `.env.example`):

| Variable                | Por defecto | Notas                                                                                                      |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `MEDIA_MODE`            | `simulated` | `simulated` (nube `galpon-mock`, como el mock) o `cloudinary`. En `production` tiene que ser `cloudinary`. |
| `CLOUDINARY_CLOUD_NAME` | (sin valor) | Nube de Cloudinary: arma las `url`. Obligatoria con `cloudinary`.                                          |
| `CLOUDINARY_API_KEY`    | (sin valor) | API key de Cloudinary. Obligatoria con `cloudinary`.                                                       |
| `CLOUDINARY_API_SECRET` | (sin valor) | API secret de Cloudinary (firma las subidas). Obligatorio con `cloudinary`; nunca se loguea.               |

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
  10 compras simultáneas sobre 5 unidades, vencimiento al leer y dueño correcto). Desde B5, el
  repositorio de pagos (un solo intento activo, `FOR UPDATE`, `payment_status` en la misma
  transacción) y las rutas de pago, el simulador y el webhook firmado por HTTP, con la pasarela
  simulada (cobro doble, avisos repetidos o desordenados, stock confirmado una vez). Desde B5c,
  los combos por HTTP (lectura de la tienda, dashboard con sesión y CSRF, orden y borrado con
  renumeración), el aviso a una tienda falsa (un solo `POST /api/revalidate` por guardado,
  reintento con 500 y ninguno con 401) y el combo como línea del carrito y del pedido (stock
  compartido, piezas en el orden del combo, combo roto → 409 y nunca 500). El E2E del sandbox se
  omite sin `MP_ACCESS_TOKEN`. Incluyen también el contrato y los casos compartidos de
  validación. Corren de a un archivo.
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
repo) en el repo del back. Cuando el contrato cambia en el front (como con los combos), se pushea
primero el `main` del front y después el del back: si no, la CI del back compara contra el
contrato viejo y falla.

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
