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
  [ADR 0005 · pagos con Mercado Pago](docs/adr/0005-pagos-con-mercado-pago.md),
  [ADR 0006 · combos y aviso a la tienda](docs/adr/0006-combos-y-aviso-a-la-tienda.md),
  [ADR 0007 · dashboard completo](docs/adr/0007-dashboard-completo.md) y
  [ADR 0008 · datos personales](docs/adr/0008-datos-personales.md).
- **Lanzamiento legal** (lo que tienen que hacer Lucas, el dueño, el abogado y el contador antes de
  abrir la tienda): [`docs/LANZAMIENTO-LEGAL.md`](docs/LANZAMIENTO-LEGAL.md).
- **Despliegue** (publicar el back en Render y la tienda y el dashboard en Vercel o, con el dominio
  propio, también en Render; paso a paso):
  [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md), con [`render.yaml`](render.yaml). El camino
  alternativo, un servidor propio con Docker, está en
  [`docs/DESPLIEGUE-SERVIDOR-PROPIO.md`](docs/DESPLIEGUE-SERVIDOR-PROPIO.md) y [`deploy/`](deploy).
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
| Este back              | `http://localhost:3001` | `PORT` y `HOST`. Prefijo `/api/v1`; Swagger UI en `/api/docs`.                 |
| Postgres / Redis (dev) | `5432` / `6379`         | `docker compose` (`npm run db:up`), solo en `127.0.0.1`.                       |

**Interfaz (`HOST`):** fuera de producción el back escucha solo en `127.0.0.1` (esta máquina); en
producción, en `0.0.0.0` (detrás del proxy o del contenedor). `HOST` acepta una IP o `localhost`
para cambiarlo. Si algo de tu máquina llama a `localhost` y lo resuelve solo como IPv6 (`::1`), usá
`http://127.0.0.1:3001` o arrancá con `HOST=::1`. El Postgres y el Redis de `docker compose` también
quedan atados a `127.0.0.1`: desde otra máquina de la red no se llega a ellos.

**Proxies de confianza (`TRUST_PROXY`, apagada por defecto):** sin ella, `req.ip` es la IP del
socket, y todo lo que entra por la tienda (su servidor reescribe `/api/v1/*` hacia el back) comparte
los contadores por IP: login, registro, pedidos, formularios. Con una lista de IPs o redes CIDR (o
`loopback`, `linklocal`, `uniquelocal`), Express toma la IP del cliente de `X-Forwarded-For`
saltando solo esos proxies, y los límites cuentan por cliente. Además se activan el límite de las
lecturas públicas (300 por minuto por IP real), el de las rutas de pago (60 por minuto en las
cuotas y 30 en cada una de las otras; el webhook nunca se limita) y el cupo de 5 reseñas por IP por
día; los pedidos que origina un proxy de confianza (el servidor de la tienda, sin
`X-Forwarded-For`) no se cuentan en esos tres.

- La tienda tiene que mandar `X-Forwarded-For` con la IP real. Hoy no la agrega: el rewrite de
  Next 16 (`next.config.ts`, proxy sin `xfwd`) reenvía la cabecera que le llega y suma
  `x-forwarded-host`, y las lecturas de su servidor (`lib/api.server.ts`) no la mandan. Hace falta
  un proxy delante de la tienda que la escriba con la IP del cliente (pisando la que mande el
  navegador), o que la tienda la agregue.
- Listá solo proxies que escriban la IP real: si la tienda reenvía tal cual lo que manda el
  navegador, cualquiera puede inventarse una IP y saltear los límites.
- Ejemplo: tienda en `10.0.0.5` y el back detrás de un proxy en `10.0.0.2`:
  `TRUST_PROXY=10.0.0.5,10.0.0.2`.
- En el despliegue con Docker (`deploy/docker-compose.yml`, el camino alternativo) ya queda
  resuelto: Caddy, el proxy de entrada, pisa `X-Forwarded-For` con la IP real y la escribe en
  `X-Real-IP`; la tienda la toma de ahí (`TRUSTED_CLIENT_IP_HEADER=x-real-ip`) y `TRUST_PROXY` es
  la red interna del compose (`172.28.0.0/24`), donde solo están Caddy y la tienda delante del back.

**Secreto compartido (`TRUSTED_PROXY_SECRET`, apagado por defecto):** la alternativa a `TRUST_PROXY`
cuando no hay IPs fijas que listar. Es el caso del camino elegido: la tienda en Render (o en
Vercel, mientras dure la mudanza; sus IPs de salida cambian) y el back en Render (que no documenta
su cadena de `X-Forwarded-For`). Con el secreto (32 caracteres o más, el mismo `API_PROXY_SECRET` de la tienda y
del dashboard), `trustedProxyMiddleware` (`src/shared/infrastructure/http/trusted-proxy.ts`) decide
en cada pedido quién es el cliente:

| El pedido trae                                                         | Cliente para los límites                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| El secreto y `x-galpon-client-ip` (la tienda, por un visitante)        | Esa IP (`req.ip` pasa a ser esa).                           |
| El secreto y `x-galpon-client-ip-from: x-forwarded-for` (el dashboard) | La primera IP de `X-Forwarded-For` (la que escribe Vercel). |
| El secreto solo (el servidor de la tienda armando sus páginas)         | Ninguno: no se cuenta en los límites por cliente.           |
| Sin el secreto, o con uno equivocado (alguien que saltea Vercel)       | La IP con la que llega: todos esos comparten un cupo.       |

- El secreto se compara en tiempo constante, las tres cabeceras se borran del pedido antes de los
  controladores y el secreto nunca se loguea.
- Con `x-galpon-client-ip-from`, `x-galpon-client-ip` se ignora: el reenvío del dashboard no tiene
  código y no puede garantizar que borra lo que mande el visitante; la tienda sí las borra
  (`proxy.ts`) y nunca manda `-from`.
- Con el secreto se activan los mismos límites que con `TRUST_PROXY` (lecturas públicas, pagos y
  cupo de reseñas). Están pensados como alternativas: no hace falta definir los dos.
- Probado de punta a punta en `test/e2e/trusted-proxy.e2e-spec.ts` y, con la tienda compilada y la
  imagen de producción, en la bitácora (B8).

**IP del borde (`TRUSTED_CLIENT_IP_HEADER`, apagada por defecto):** con todo en Render y el dominio
propio, el dashboard (`admin.galponmates.com.ar`) le habla directo al back
(`api.galponmates.com.ar`) desde el navegador, sin el secreto. Render deja el socket en su proxy
interno y a `X-Forwarded-For` le agrega al final lo que mande el visitante, así que ninguna de las
dos sirve. Cloudflare, que está delante de todos los servicios de Render, escribe la IP del
visitante en `True-Client-IP` pisando la que mande el navegador (no lo dice la documentación de
Render: lo dice su soporte, citado en
[rohitpaulk.com/articles/render-rails-remote-ip](https://rohitpaulk.com/articles/render-rails-remote-ip)).
Con `TRUSTED_CLIENT_IP_HEADER=true-client-ip` (lo pone `render.yaml`), `trustedProxyMiddleware`
resuelve:

| El pedido trae                                             | Cliente para los límites                    |
| ---------------------------------------------------------- | ------------------------------------------- |
| El secreto (la tienda), con o sin `x-galpon-client-ip`     | Lo de la tabla de arriba: el secreto manda. |
| Sin el secreto y una IP válida en la cabecera de borde     | Esa IP (`req.ip` pasa a ser esa).           |
| Sin el secreto y sin una IP válida en la cabecera de borde | La IP con la que llega, como antes.         |

- Funciona con o sin `TRUSTED_PROXY_SECRET`; sin el secreto, lo que reenvía la tienda contaría por
  la IP de su servidor, así que en Render van los dos.
- No acepta `x-forwarded-for`, `forwarded` ni las tres `x-galpon-`. Solo hay que ponerla detrás de
  una plataforma que pise esa cabecera: en un servidor propio con Caddy alcanza con `TRUST_PROXY`.
- Con el proxy de Cloudflare propio (nube naranja) delante de Render no está probado qué IP llega en
  esa cabecera: por eso la guía pide los registros en "DNS only".

**Cuerpos de los pedidos:** JSON de hasta 100 kB y sin comprimir (`Content-Encoding: gzip` da 415).
Los formularios (`application/x-www-form-urlencoded`) solo se aceptan con el simulador de pagos
prendido (nunca en producción), planos y chicos.

**Caché:** toda respuesta que no sea una lectura pública sale con `Cache-Control: no-store` y
`Vary: Cookie` (cuenta, admin, pedido por token, pagos, `GET /auth/csrf`): un CDN o proxy no las
guarda. Las lecturas públicas no cambian.

**CORS:** solo `ADMIN_ORIGIN` (en desarrollo `http://localhost:5173`) recibe permiso, con
credenciales (las cookies de sesión del admin). La tienda no lo necesita: su servidor llama al back
y reescribe `/api/v1/*` hacia él, así que el navegador siempre habla con la tienda. Un pedido desde
otro origen no recibe cabeceras CORS y el navegador lo bloquea.

**Orígenes en producción:** con `NODE_ENV=production`, `STORE_ORIGIN` y `ADMIN_ORIGIN` son
obligatorias y explícitas (los valores de `localhost` solo valen en desarrollo y en test): olvidar
`ADMIN_ORIGIN` habilitaría CORS con credenciales para `localhost`.

**Aviso a la tienda:** cada guardado del dashboard (y cada pedido creado, pagado, vencido o
cancelado) le pide a la tienda (en `STORE_ORIGIN`, o en `STORE_INTERNAL_ORIGIN` si está definida:
el compose de producción usa `http://store:3000`, la red interna) que regenere sus etiquetas, con
el secreto `STORE_REVALIDATE_SECRET`. La variable y el mecanismo están en "Combos y aviso a la tienda"; las
etiquetas de cada escritura, en "Dashboard".

## Puesta en marcha

```bash
cp .env.example .env    # valores de desarrollo; las variables del entorno tienen prioridad
npm install             # también genera el cliente de Prisma e instala los hooks de git
npm run db:up           # Postgres 17 y Redis 8 con docker compose (espera a que estén sanos)
npm run db:migrate      # aplica las migraciones
npm run db:seed         # carga los datos del diseño (se puede repetir)
npm run dev             # nest start --watch en http://localhost:3001
```

- `NODE_ENV` es **obligatorio y explícito** (`development`, `test` o `production`): sin él la API
  no arranca ni corre el seed, así un despliegue que se olvida de definirlo nunca queda como
  desarrollo (con Swagger, el simulador de pagos y los links de recuperación en el log). El
  `.env.example` trae `NODE_ENV=development`.
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

### Producción: Render (el camino elegido)

El back va en **Render**. La tienda y el dashboard están hoy en **Vercel** y se mudan a Render con
el dominio propio (`galponmates.com.ar`, `admin.` y `api.`), con el Blueprint del repo del front.
La guía paso a paso es [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) (la mudanza, en "Todo en Render
con el dominio propio").

- [`render.yaml`](render.yaml): el Blueprint de Render. Crea el servicio web `galpon-mates-api`
  (desde el `Dockerfile`), Postgres 17 (`galpon-mates-db`) y Render Key Value
  (`galpon-mates-redis`, sin desalojo y sin acceso desde internet), los tres en la región Virginia.
  Arranca en los planes gratis (para probar); las tres líneas marcadas con `PLAN` pasan a los
  pagos. Declara el dominio `api.galponmates.com.ar`. Es válido contra el esquema oficial de
  Render.
- [`Dockerfile`](Dockerfile): la etapa `runtime` es la imagen que corre en Render. Lleva `dist`,
  las dependencias de producción y el seed y `admin:password` compilados (`dist-scripts`, con
  `npm run build:scripts`); corre como el usuario `node`. Al arrancar hace
  `npx prisma migrate deploy`, con `SEED_IF_EMPTY=true` corre el seed con `--if-empty` (siembra
  solo una base sin productos ni admin; con datos no toca nada) y después `node dist/main`. Así no
  hace falta consola ni comando previo al despliegue, que el plan gratis de Render no tiene.
- El servicio escucha en `PORT` (10000 en Render) y en `0.0.0.0`; la ruta de salud es
  `/api/v1/health`.
- La IP real de cada cliente llega con `TRUSTED_PROXY_SECRET` (lo que reenvía la tienda) y
  `TRUSTED_CLIENT_IP_HEADER=true-client-ip` (el dashboard llamando directo; ver "Proxies de
  confianza"). `TRUST_PROXY` queda sin definir.
- En la consola de Render (plan pago): `npm run admin:password:prod` y, solo sobre una base vacía,
  `npm run db:seed:prod`.
- El pool de Postgres tiene `connectionTimeoutMillis` de 10 s y `statement_timeout` de 30 s
  (`buildPoolConfig`). Swagger UI no se monta en producción.

### Producción: camino alternativo con Docker en un servidor propio

No es el camino elegido. Es otro compose, [`deploy/docker-compose.yml`](deploy/docker-compose.yml):
un solo servidor con Caddy (HTTPS automático), la tienda, el dashboard, este back, Postgres, Redis y
una copia diaria de la base. Su guía es
[`docs/DESPLIEGUE-SERVIDOR-PROPIO.md`](docs/DESPLIEGUE-SERVIDOR-PROPIO.md).

- [`Dockerfile`](Dockerfile): el servicio `api` usa la etapa `runtime` (la misma de Render). La
  etapa `tools` (servicio `tools`, con el perfil `tools`) trae el proyecto entero para las tareas a
  mano: `npm run db:seed` y `npm run admin:password`.
- [`deploy/.env.example`](deploy/.env.example): las variables que carga Lucas (dominio, secretos,
  Mercado Pago, Cloudinary y SMTP). Los orígenes, `TRUST_PROXY`, `DATABASE_URL` y `REDIS_URL` los
  arma el compose.
- [`deploy/Caddyfile`](deploy/Caddyfile): `DOMAIN` (tienda), `www.DOMAIN` (redirige),
  `admin.DOMAIN` y `api.DOMAIN`. `/api/revalidate` de la tienda no se expone a internet: el back
  le avisa por la red interna.
- [`deploy/backup.sh`](deploy/backup.sh): `pg_dump` diario en `deploy/backups/` (no se versiona),
  14 días.
- [`deploy/docker-compose.local.yml`](deploy/docker-compose.local.yml): el mismo compose para un
  ensayo en la compu, sin dominio ni HTTPS (back en el 3021, tienda en el 4410 y dashboard en el
  5410).
- Postgres y Redis no publican puertos. Redis corre con `appendonly yes` y
  `maxmemory-policy noeviction`: guarda las colas (vencimiento de pedidos, mails, avisos).

## Base de datos y seed

- **Migraciones** en `prisma/migrations/`: `npm run db:migrate` en desarrollo y
  `npx prisma migrate deploy` en CI y producción. `npm run db:reset` borra la base de desarrollo y
  vuelve a migrar (después, `npm run db:seed`).
- **Cliente de Prisma** en `src/generated/prisma` (no se versiona): lo genera `postinstall`, o
  `npm run db:generate` después de cambiar `prisma/schema.prisma`.
- **Seed** (`npm run db:seed` o `npx prisma db seed`): 6 líneas, 27 productos (los 16 mates con
  los cuatro cueros), 18 reseñas (10 destacadas), 9 contenidos (con los cuatro textos legales), 5 combos (4 publicados), ajustes y
  3 envíos, los mismos datos de las fixtures del front, y el admin semilla (ver "Cuenta y admin").
  Es idempotente: correrlo dos veces deja lo mismo.
  - Líneas, productos, reseñas y combos se pisan con los valores del diseño. Los productos se
    buscan por `sequence` (el código "N°07"): uno renombrado desde el dashboard vuelve al slug del
    diseño sin duplicarse, y el slug del panel pasa al historial (la tienda lo redirige).
  - Contenidos, ajustes y envíos **solo se crean si faltan**: un seed nuevo nunca pisa lo que se
    guardó desde el dashboard. Una base sembrada antes de B6 conserva los títulos viejos del
    inicio ("Seis líneas para cada ronda", "Los más elegidos de la ronda") hasta que se editen en
    el dashboard (Contenido → Inicio) o se borre la fila y se vuelva a sembrar.
  - Los combos se guardan con un UUID v5 de su clave del mock: un seed nuevo les devuelve el
    nombre, el precio, el estado, la posición y las piezas de las fixtures. Los combos creados desde
    el dashboard no los toca.
- **En producción el seed se corre una sola vez** (con `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios):
  una corrida posterior devolvería las líneas, los productos, las reseñas y los combos del diseño a
  sus valores iniciales.
- **`--if-empty`** (`npm run db:seed -- --if-empty`, o `SEED_IF_EMPTY=true` en la imagen de
  producción): siembra solo si la base no tiene productos ni un admin; si tiene, avisa en una línea
  y termina bien sin tocar nada ni pedir las credenciales del admin. Es lo que usa Render en cada
  arranque.
- **`npm run admin:password`** (`prisma/admin-password.ts`): con `ADMIN_EMAIL` y `ADMIN_PASSWORD`
  en el entorno crea ese admin o, si ya existe, le cambia la contraseña y lo reactiva, sin tocar
  nada más. Es la forma de recuperar el acceso al dashboard en producción. No convierte en admin a
  una cuenta de cliente; las sesiones abiertas del admin siguen hasta vencer.
- Los datos salen de `prisma/seed-data/`, que se regenera desde las fixtures del front con
  `node scripts/import-fixtures.mjs` (ver [`prisma/seed-data/README.md`](prisma/seed-data/README.md)).

## Contrato

`npm run contract:check` arma la app (sin Docker), genera el Swagger y lo compara, normalizado,
con `../frontend/docs/api/openapi.yaml` (o `CONTRACT_PATH`). Falla si una operación implementada
difiere del contrato o si Swagger expone una ruta que no está en `IMPLEMENTED_PATHS`
(`test/contract/openapi.contract.spec.ts` y las listas por tarea de `test/contract/b6/`), y lista
las operaciones pendientes (desde B6, **83 implementadas de 83** y ninguna pendiente). Compara
rutas, parámetros, respuestas, `security` y `requestBody`. Además corre los casos compartidos de
validación del front (`validation-cases.json`, al lado del `openapi.yaml`) contra los DTOs de
identidad, del checkout (contacto y envío), del documento de quien paga con tarjeta y de los
combos del dashboard (alta, edición y orden) y, desde B6, los del resto del dashboard (productos,
líneas, fotos, pedidos, reseñas, mensajes, contenidos y ajustes) y los formularios públicos de
contacto, arrepentimiento y reseña (`test/contract/validation-cases.contract.spec.ts`): las mismas
entradas dan los mismos errores en los dos lados.

- **Otro contrato:** `CONTRACT_PATH` apunta a otro `openapi.yaml` (los casos de validación se
  leen del `validation-cases.json` de esa misma carpeta). Sirve para probar el back contra una
  rama del front que todavía no está en `main`, por ejemplo desde un worktree:
  `CONTRACT_PATH="../frontend-inicio-combos/docs/api/openapi.yaml" npm run contract:check`. Así
  se construyó B5c, antes de que el front mergeara los combos.
- **Cueros y la CI:** B6 se construyó con
  `CONTRACT_PATH="../frontend-ajustes/docs/api/openapi.yaml"` (la rama `feat/ajustes-tienda` del
  front, con los cueros por producto). Hoy el `main` local del front ya la tiene (`24b62ab`), así
  que `npm run contract:check` también pasa sin `CONTRACT_PATH`; si `../frontend` no está en ese
  `main`, usá el `CONTRACT_PATH` del worktree. La CI clona el `main` **remoto** del front: hasta
  que ese `main` tenga los cueros, el contrato de la CI falla. Por eso se pushea primero el `main`
  del front y después el del back (lo mismo pasó con los combos).

Para ver las diferencias de una ruta: `node scripts/openapi-diff.mjs products/{slug}` (en Git Bash,
sin `/` inicial o entre comillas, para que no la convierta en una ruta de Windows).

## Probar la tienda contra este back

Las 13 lecturas públicas del contrato (`/categories`, `/products…`, `/reviews/featured`,
`/content/*`, `/settings/public`) están implementadas. Con `TRUST_PROXY` llevan un límite de 300 por
minuto por IP real del cliente; el servidor de la tienda (que las pide para armar sus páginas) no se
limita, y sin `TRUST_PROXY` no se limita nada (ver "Puertos y orígenes"). Desde B3 funcionan la cuenta y el admin, desde B4 el carrito, el
checkout y los pedidos (ver "Pedidos y stock"), y desde B5 el pago con Mercado Pago contra el
simulador del back (ver "Pagos con Mercado Pago"). Probadas contra Postgres y Redis reales: los
E2E con Testcontainers y esta misma prueba (ver "Verificación" de cada pieza en
[`docs/BITACORA.md`](docs/BITACORA.md)).

1. Acá, con Docker Desktop abierto: `npm run db:up`, `npm run db:migrate`, `npm run db:seed` y
   `STORE_ORIGIN=http://localhost:4300 npm run dev`. `STORE_ORIGIN` tiene que ser el origen de la
   tienda compilada: ahí vuelve el comprador después del simulador de Mercado Pago, y ahí apuntan
   los enlaces de los mails (ver "Mails").

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

Desde B6 también funcionan contacto, arrepentimiento y reseñas nuevas (desde B7 el contacto y el
arrepentimiento mandan su mail; ver "Mails"). Lo que sí falla en modo `live` es de la tienda:
después de que el back le avisa `categories` o `settings` (cualquier guardado de un producto, una línea o los
ajustes), `/producto/[slug]` y `/tienda/[linea]` responden 500 hasta reiniciar `next start` (ver
"Dashboard").

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

- **Cookies:** `__Host-galpon_session` (tienda: 30 días; la anónima que solo da el CSRF, 30
  minutos) y `__Host-galpon_admin` (admin: 8 h). Duran un plazo fijo, que no se renueva con el uso.
  - Cada cuenta tiene como mucho 20 sesiones abiertas: al abrir otra, se cierra la más vieja.
  - Restablecer la contraseña (cliente) o cambiarla (admin) cierra todas las sesiones de la cuenta,
    también una que se esté abriendo en ese momento con la contraseña vieja; al cambiarla desde el
    admin, la sesión desde la que se cambió sigue valiendo (mismo CSRF).
  - Van siempre con `Path=/; HttpOnly; Secure; SameSite=Lax`, también en `http://localhost`.
  - **Probá con Chrome o Firefox:** aceptan cookies `Secure` en `localhost`. Safari no, y ahí la
    sesión no se guarda.
  - El token CSRF va en `X-CSRF-Token`. Si falta o no es el de la sesión, la respuesta es 403
    `csrf_invalid`, y el front pide uno nuevo.
- **Admin semilla:** fuera de producción, `admin@galponmates.com.ar` / `galpon-demo-2026`, las
  credenciales del demo del front (o las de `ADMIN_EMAIL` y `ADMIN_PASSWORD`, si las definís).
  - **En producción** el seed exige `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios (la contraseña de 12
    caracteres o más y distinta de la de demostración); si falta alguna, no corre.
  - `npm run db:seed` lo crea solo si no existe y nunca lo pisa.
  - Para cambiar la contraseña: en el admin, "Mi cuenta" → "Cambiar contraseña"
    (`POST /admin/auth/password`).
  - Un nuevo seed no la restablece. Si la olvidás, `npm run db:reset && npm run db:seed` (borra la
    base de desarrollo).
- **Recuperación de contraseña:** `POST /auth/password/forgot` responde siempre 202 y, si el email
  es de una cuenta activa, manda el mail `password-reset` (ver "Mails"; con `MAIL_MODE=log` el
  enlace no se loguea: para verlo en desarrollo, usá Mailpit).

  - El link sale de `STORE_ORIGIN`.
  - Vale 60 minutos y una sola vez.
  - Al usarlo se cierran todas las sesiones del usuario.

- **Eliminar la cuenta** (`DELETE /me`, desde B7): pide la contraseña actual y el CSRF, borra el
  usuario, el cliente, las direcciones, los tokens y las reseñas pendientes, cierra todas las
  sesiones y borra la cookie (204). Los pedidos quedan 10 años sin vínculo con la cuenta (ver
  [ADR 0008](docs/adr/0008-datos-personales.md)) y sale el mail `account-deleted`. Una contraseña
  equivocada da 422 `invalid_password` y cuenta para el bloqueo del inicio de sesión.
- **Registro:** crea siempre una cuenta con su propio cliente. Si ese email ya había comprado como
  invitado, la cuenta **no** adopta esos pedidos ni sus datos (escribir un email no prueba que sea
  tuyo): siguen leyéndose con el link del pedido.
- **Límites:**
  - 20 pedidos por minuto por IP en registro, ingreso (cliente y admin), `forgot` y `reset`.
  - Cada ingreso cuenta por email **y por IP**, antes de verificar la contraseña: 10 intentos del
    mismo email desde la misma IP en 15 minutos y el siguiente responde 429 con `Retry-After` (el
    décimo también, si falla). Durante esa espera tampoco entra la contraseña correcta desde esa IP;
    desde otra, sí. La IP se normaliza: una IPv4 mapeada (`::ffff:203.0.113.7`) es esa IPv4 y una
    IPv6 cuenta por su red /64.
  - Además, un tope por email sin importar la IP: con 100 intentos verificados en una hora (los
    que el bloqueo por IP ya frenó no suman) el email responde el mismo 429 desde cualquier IP hasta
    que termina la hora. Un ingreso correcto borra los dos contadores.
  - La libreta guarda hasta 20 direcciones por cliente: la siguiente responde 422
    `validation_error` con el error en `addresses` (`address_book_full`).
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
  - Desde B6 **todas las pantallas** funcionan contra el back (ver "Dashboard"): Resumen, Pedidos,
    Productos, Líneas, Combos, Contenido, Reseñas, Mensajes y Ajustes.

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
    ese límite, porque toda la tienda llega desde la IP de su servidor; las de pago llevan el suyo,
    por cliente y solo con `TRUST_PROXY` (ver "Pagos con Mercado Pago").
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
fallo posterior sí, porque una secuencia no vuelve atrás. Por eso lo que se puede rechazar antes se
rechaza antes (auditoría NV-15): el campo trampa responde un pedido inventado, una dirección con
caracteres que Postgres no guarda da 422 y el cuarto pedido pendiente del mismo cliente da 429, sin
tocar la secuencia. El contrato fija los cinco dígitos (`^GLP-[0-9]{5}$`), así que el límite son
89.999 pedidos: a 50 por día alcanzan para unos 4 años; antes del 80 % (`SELECT last_value FROM
order_number_seq` > 82000) hay que ampliar el formato en el contrato. `npm run db:reset` la reinicia. Los
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
- **Límites:** con `TRUST_PROXY`, 60 consultas de cuotas por minuto por cliente y 30 por minuto en
  cada una de las otras rutas de pago (429 con `Retry-After`); sin ella no se cuentan (ver "Puertos
  y orígenes").
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

Desde B6 el diálogo de un combo lista las piezas con `GET /admin/products`, así que un combo nuevo o
un cambio de piezas también se hace desde el dashboard. El aviso de las demás escrituras es
genérico (`storefront.stale`, ver "Dashboard"); `combo.changed` sigue andando igual.

## Dashboard

Desde B6 el back tiene las 83 operaciones del contrato: todo el dashboard y los formularios
públicos que faltaban ([ADR 0007](docs/adr/0007-dashboard-completo.md)). Todas las rutas
`/admin/*` piden la sesión del admin y las escrituras, además, `X-CSRF-Token`. Salvo el ingreso,
no cuentan para el límite de pedidos por IP (`@SkipThrottle`).

| Rutas                                                                              | Módulo      | Qué hacen                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/dashboard/summary`                                                     | `dashboard` | Ventas de hoy y de 7 días (hora de Buenos Aires), para despachar, reseñas y mensajes pendientes, alertas de pago y poco stock.      |
| `GET/POST /admin/products`, `GET/PATCH /admin/products/{id}`, `…/{id}/archive`     | `catalog`   | Productos en cualquier estado, con stock disponible, cueros, fotos, `expectedUpdatedAt` (409) y slugs anteriores que redirigen.     |
| `GET/POST /admin/categories`, `PATCH/DELETE /admin/categories/{id}`, `PUT …/order` | `catalog`   | Líneas: alta, edición, borrado y orden. Cambiar el grupo de una línea con productos da 422.                                         |
| `POST /admin/media/signature`                                                      | `media`     | Firma de la subida a Cloudinary (`MEDIA_MODE`; ver "Fotos").                                                                        |
| `GET /admin/orders`, `GET /admin/orders/{number}`, `POST …/{number}/status`        | `orders`    | Listado (filtros, búsqueda sin acentos, páginas de 20), detalle y cambio de estado: preparación, despachado, entregado o cancelado. |
| `GET /admin/reviews`, `PATCH /admin/reviews/{id}`                                  | `reviews`   | Moderación: aprobar, ocultar y destacar en el inicio.                                                                               |
| `GET /admin/messages`, `PATCH /admin/messages/{id}`                                | `support`   | Bandeja de contacto y arrepentimiento; leído o no.                                                                                  |
| `GET/PUT /admin/content/…` (inicio, nosotros, preguntas, pie, pestañas, legales)   | `content`   | Los 9 contenidos (12 operaciones). Último guardado gana.                                                                            |
| `GET/PUT /admin/settings`                                                          | `settings`  | Ajustes y envíos (el IVA se redondea a 2 decimales).                                                                                |
| `POST /contact`, `POST /withdrawals`, `POST /products/{slug}/reviews`              | públicas    | Contacto, arrepentimiento (código `ARR-` + 6 dígitos) y reseña nueva (queda pendiente), con campo trampa (`website`).               |

- **Stock:** el dashboard ve y guarda las unidades **disponibles** (`on_hand − reserved`); guardar
  escribe `on_hand = stock + reserved`. Con stock 0 la tienda muestra "Sin stock" y no deja
  agregarlo al carrito (la ficha ofrece "Consultar por mail" y el botón de la tarjeta queda
  deshabilitado), y el back lo rechaza en la cotización (`sold_out`).
- **Cueros:** solo los mates (`leathers`, de 0 a 4, en orden canónico). Con uno solo, la ficha
  muestra esa muestra; sin ninguno, no hay selector y el carrito manda `options: null`. Un cuero que
  el mate no ofrece da 422 "Ese cuero no está disponible para este mate.".
- **Cancelar** un pedido `pending_payment` libera la reserva, cierra el intento de pago activo (si
  hay uno; si no, `paymentStatus` queda `none`) y la pasarela lo resuelve después (handler de
  `order.cancelled` en `payments`). Con un pago en curso, 409 `payment_in_progress`.
- **Aviso a la tienda** (`storefront.stale`, en la misma transacción de la escritura; un 4xx no
  avisa nada):

  | Escritura                                  | Etiquetas                                                                      |
  | ------------------------------------------ | ------------------------------------------------------------------------------ |
  | Producto (alta, edición, archivo)          | `products`, `product:{slug}` (y el anterior si cambió), `categories`, `combos` |
  | Línea (alta, edición, borrado, orden)      | `categories`, `products`                                                       |
  | Contenido `{key}`                          | `content:{key}` (`product-tabs` suma `products`)                               |
  | Ajustes                                    | `settings`, `products`, `combos`                                               |
  | Moderación de una reseña                   | `reviews:featured`, `reviews:{slug}`, `product:{slug}`, `products`             |
  | Pedido creado, pagado, vencido o cancelado | `products`, `combos`                                                           |

  En el log del back queda, por ejemplo,
  `La tienda regeneró products, product:mate-imperial-criollo, categories, combos (evento storefront.stale)`.
  La caché del catálogo en Redis lleva versión (`catalog:v{n}:…`): cada escritura de productos o
  líneas y cada moderación la sube, así la tienda nunca relee del back un dato viejo.

- **Bug conocido de la tienda** (front `24b62ab`, Next 16.4.2): después de regenerar `categories` o
  `settings`, la tienda compilada responde **500** en `/producto/[slug]` y `/tienda/[linea]`
  ("Next.js encountered uncached or runtime data during prerendering",
  `NEXT_STATIC_GEN_BAILOUT`) hasta que se reinicia `next start`. El inicio y las demás páginas
  siguen bien, y `products`, `product:{slug}`, `combos`, `content:*` y `reviews:*` no la rompen. Se
  reproduce sin el back, con un `POST /api/revalidate` a la tienda con `{"tags":["categories"]}`. El
  arreglo es del front.

**Probarlo en vivo** (así se probó B6): igual que en "Combos y aviso a la tienda", con
`MEDIA_MODE=simulated` en el back, la tienda en el 4320 y el dashboard en el 5320, compilados
desde el mismo commit del front. Si el 3001 está ocupado (en la compu de Lucas lo puede tomar otro
`next`), arrancá el back con un `PORT` libre y compilá la tienda y el dashboard con `API_BASE_URL` y
`VITE_API_BASE_URL` en ese puerto. Al terminar, `npm run db:seed` devuelve los productos al diseño
(los contenidos y los ajustes guardados quedan).

### Auditoría del dashboard (`audit_logs`)

Desde B8 cada escritura **exitosa** del admin (alta, edición, borrado, orden, estado de un pedido,
ajustes, contenidos y cambio de contraseña) deja una fila en `audit_logs`: quién, qué, sobre qué y
qué cambió. No tiene pantalla ni operación en el contrato: se consulta por SQL.

- **Cómo se anota:** un interceptor global del módulo `audit` actúa en todo `POST`, `PUT`, `PATCH`
  o `DELETE` de `/admin/*` con sesión de admin, sin decorar los controladores: una escritura nueva
  queda auditada sola (con un registro genérico), y `admin-write-routes.spec.ts` falla hasta que se
  la describa en `ADMIN_WRITE_DESCRIPTORS` o se la excluya a propósito.
- **`action`** es `<entidad>.<verbo>`: `category.create|update|delete|reorder`,
  `combo.create|update|delete|reorder`, `product.create|update|archive`, `content.update`,
  `order.status`, `review.update`, `settings.update`, `contact_message.update` y
  `admin_user.password`. `entity_type` es la entidad y `entity_id` su id (el número del pedido, la
  clave del contenido, `1` en los ajustes; `null` al reordenar).
- **`changes`** (jsonb): `input` (el cuerpo que mandó el dashboard; si pesa más de 32 kB, solo
  `{ "truncated": true, "bytes": N }`), y `before` y `after` con **solo las columnas que cambiaron**
  de la fila principal (en un alta, `after` es la fila entera; en un borrado, `before`).
- **Sin datos de clientes:** de pedidos, reseñas y mensajes nunca se guarda la fila entera, solo
  las columnas que cambian (el estado). El cambio de contraseña se anota con `changes` vacío.
- **No se anotan** el ingreso, la salida ni la firma de fotos (no cambian datos).
- **Si la auditoría falla,** la escritura no se revierte ni cambia la respuesta: queda un error en
  el log ("No se pudo guardar la auditoría de …") con la acción y la entidad, sin el cuerpo. Una
  escritura que termina en 4xx o 5xx no deja fila.
- No tiene purga: no guarda datos personales de clientes. Un usuario con filas de auditoría no se
  puede borrar (`ON DELETE RESTRICT`); solo los admins las tienen.

```sql
-- Los últimos 50 cambios, con el email del admin
SELECT a.created_at, u.email, a.action, a.entity_type, a.entity_id, a.changes
  FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
 ORDER BY a.created_at DESC LIMIT 50;

-- Historial de un pedido (o de un producto: entity_type = 'product' y su id)
SELECT created_at, action, changes->'before' AS antes, changes->'after' AS despues
  FROM audit_logs WHERE entity_type = 'order' AND entity_id = 'GLP-10001' ORDER BY created_at;
```

## Fotos (Cloudinary)

Desde B6 las fotos del dashboard (productos, líneas y socios de Nosotros) se guardan sin llamar a la
Admin API de Cloudinary: `POST /admin/media/signature` firma la subida (en `simulated`, la firma
del mock), y al guardar una foto se acepta si su `publicId` está en la carpeta de su uso
(`galpon/productos/`, `galpon/lineas/`, `galpon/socios/`, `galpon/sitio/`, sin segmentos `.` o
`..` ni caracteres de control) o si es la que el recurso ya tiene, y la `url` se arma con la nube.
Si no, 422 `unknown_image` "La foto no existe: subila de nuevo". El texto alternativo es por uso.
Con `MEDIA_MODE=simulated` la firma es falsa: el dashboard no puede subir fotos nuevas a
Cloudinary, pero guarda las que el producto ya tiene. Las variables (detalle en `.env.example`):

| Variable                | Por defecto | Notas                                                                                                      |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `MEDIA_MODE`            | `simulated` | `simulated` (nube `galpon-mock`, como el mock) o `cloudinary`. En `production` tiene que ser `cloudinary`. |
| `CLOUDINARY_CLOUD_NAME` | (sin valor) | Nube de Cloudinary: arma las `url`. Obligatoria con `cloudinary`.                                          |
| `CLOUDINARY_API_KEY`    | (sin valor) | API key de Cloudinary. Obligatoria con `cloudinary`.                                                       |
| `CLOUDINARY_API_SECRET` | (sin valor) | API secret de Cloudinary (firma las subidas). Obligatorio con `cloudinary`; nunca se loguea.               |

## Mails

Desde B7 (LS-6) el back manda los mails que la tienda promete y que la ley exige (la confirmación
del pedido, CCyC 1108), en español, en texto plano y HTML simple, sin imágenes remotas ni rastreo y
sin newsletter. Cada mail sale por la cola BullMQ `mails` (job `mail.send`, 5 intentos con backoff
exponencial): si el servidor de mails está caído la compra responde igual y el mail se reintenta;
agotados los intentos queda en fallidos con un `warn` sin datos personales.

| Mail               | Lo dispara                                                   | Va a                  |
| ------------------ | ------------------------------------------------------------ | --------------------- |
| `order-received`   | `order.created` (resumen, total, reserva, arrepentimiento)   | Email del pedido      |
| `payment-approved` | `order.paid`                                                 | Email del pedido      |
| `order-shipped`    | `order.shipped` (empresa y seguimiento)                      | Email del pedido      |
| `order-delivered`  | `order.delivered`                                            | Email del pedido      |
| `order-cancelled`  | `order.cancelled` y `order.expired` (el motivo en una línea) | Email del pedido      |
| `withdrawal-code`  | `withdrawal.requested` (el código `ARR-…`)                   | Email de la solicitud |
| `contact-received` | `contact.received`                                           | Email del mensaje     |
| `account-created`  | `customer.registered`                                        | Email de la cuenta    |
| `password-reset`   | `POST /auth/password/forgot` (directo a la cola, sin outbox) | Email de la cuenta    |
| `account-deleted`  | `DELETE /me` (directo a la cola, sin outbox)                 | Email de la cuenta    |

Los eventos llevan solo ids: el mail lee los datos al salir. Un evento repetido no manda dos mails
(`jobId` = id del evento + plantilla). El enlace de restablecer contraseña no se guarda en Postgres
y su job se borra apenas sale. Los enlaces usan `STORE_ORIGIN`; el pie lleva el email de contacto y
los datos del vendedor de los ajustes. Los mails de contacto y de arrepentimiento no repiten el
nombre ni el texto que se escribió (el formulario no verifica el email).

| Variable    | Por defecto | Notas                                                                                              |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `MAIL_MODE` | `log`       | `log` (no manda nada; loguea la plantilla y `l***@dominio.com`) o `smtp`. En `production`, `smtp`. |
| `SMTP_HOST` | (sin valor) | Servidor SMTP de cualquier proveedor. Obligatorio con `smtp`.                                      |
| `SMTP_PORT` | (sin valor) | 465 (TLS directo) o 587 (STARTTLS obligatorio, salvo en `localhost`). Obligatorio con `smtp`.      |
| `SMTP_USER` | (sin valor) | Usuario. Obligatorio con `smtp`.                                                                   |
| `SMTP_PASS` | (sin valor) | Contraseña. Obligatoria con `smtp`; nunca se loguea.                                               |
| `MAIL_FROM` | (sin valor) | Remitente, por ejemplo `Galpón Mates <hola@dominio.com>`. Obligatorio con `smtp`.                  |

**Probarlo en desarrollo sin mandar mails de verdad:** levantá Mailpit
(`docker run --rm -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit`),
arrancá el back con `MAIL_MODE=smtp`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_USER=dev`,
`SMTP_PASS=dev` y `MAIL_FROM="Galpón Mates <hola@galpon.test>"`, y mirá los mails en
`http://localhost:8025` (bajá el contenedor al terminar). Los tests no mandan mails: el adaptador
SMTP se prueba con el transporte de prueba de `nodemailer` y los E2E usan un doble de `MailPort`
(`createApp({ mailer })`).

**Prueba en vivo (cierre de B7):** con el back compilado en el 3021, `MAIL_MODE=smtp` contra un
servidor SMTP falso local (un script con `node:net` que guarda cada mensaje) y curl, el pedido, el
pago simulado, el despacho, el arrepentimiento, el contacto, el registro, el olvido de contraseña
y la baja de la cuenta mandaron los ocho mails esperados, cada uno solo a su destinatario, y el log
no mostró ningún email ni el enlace de restablecer (ver la bitácora, B7).

## Scripts

| Script                        | Qué hace                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                 | Levanta la API en modo watch (`nest start --watch`), cargando `.env`.             |
| `npm run build`               | Compila a `dist/` con `tsconfig.build.json`.                                      |
| `npm start`                   | Corre la versión compilada (`node dist/main`).                                    |
| `npm run typecheck`           | `tsc --noEmit` sobre `src/`, `test/`, `prisma/` y las configs.                    |
| `npm run lint`                | Verifica las versiones fijadas y corre ESLint (incluye las fronteras de capas).   |
| `npm run format`              | Formatea todo con Prettier.                                                       |
| `npm run format:check`        | Revisa el formato sin escribir.                                                   |
| `npm test`                    | Unitarios (`src/**/*.spec.ts`) y el test de fronteras (`test/lint/`), sin Docker. |
| `npm run test:e2e`            | E2E (`test/**/*.e2e-spec.ts`, Testcontainers) y contrato (`test/contract/`).      |
| `npm run contract:check`      | Solo el test de contrato, mostrando las operaciones pendientes.                   |
| `npm run db:up`               | `docker compose up -d --wait` (Postgres y Redis de desarrollo).                   |
| `npm run db:down`             | `docker compose down` (conserva los volúmenes).                                   |
| `npm run db:migrate`          | `prisma migrate dev`: aplica (y, si cambió el esquema, crea) migraciones.         |
| `npm run db:generate`         | Regenera el cliente de Prisma.                                                    |
| `npm run db:reset`            | Borra la base de desarrollo y vuelve a migrar (sin seed).                         |
| `npm run db:seed`             | Carga los datos del diseño (idempotente).                                         |
| `npm run admin:password`      | Crea el admin de `ADMIN_EMAIL` o le cambia la contraseña, sin tocar el catálogo.  |
| `npm run build:scripts`       | Compila el seed y `admin:password` a `dist-scripts/` (para la imagen, sin `tsx`). |
| `npm run db:seed:prod`        | El seed ya compilado (`node dist-scripts/…`): dentro de la imagen de producción.  |
| `npm run admin:password:prod` | `admin:password` ya compilado: dentro de la imagen de producción.                 |

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
  compartido, piezas en el orden del combo, combo roto → 409 y nunca 500). Desde B6, el dashboard
  completo por HTTP (productos con stock disponible, `expectedUpdatedAt` y slugs con historial;
  líneas; firma de fotos en los dos modos; pedidos con cancelación y la pasarela; reseñas;
  mensajes; contenidos; ajustes; resumen), contacto y arrepentimiento, `storefront.stale` con la
  tienda falsa (las etiquetas exactas de cada escritura, nada en un 4xx), la caché con versión, los
  cueros de punta a punta y el seed (un rename no duplica; contenidos y ajustes no se pisan). El E2E
  del sandbox se omite sin `MP_ACCESS_TOKEN`. Incluyen también el contrato y los casos compartidos de
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
render.yaml               producción en Render: el back, Postgres y Key Value (Blueprint)
Dockerfile                la imagen del back (Render y el camino alternativo con Docker)
deploy/                   camino alternativo, servidor propio: compose, Caddyfile, .env.example, copia
docs/                     BITACORA.md, DESPLIEGUE.md (Vercel y Render), DESPLIEGUE-SERVIDOR-PROPIO.md,
                          LANZAMIENTO-LEGAL.md, adr/ y superpowers/
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
- **`nodemailer` 10.6.0** trae sus tipos (sin `@types/nodemailer`) y se importa con
  `import { createTransport } from 'nodemailer'` (el paquete publica CJS y ESM).
- **Node:** `@nestjs/cli` trae `@angular-devkit` 22, que pide Node ≥ 22.22.3 y avisa `EBADENGINE`
  con versiones anteriores de Node 22; el build y el watch funcionan igual, pero conviene
  actualizar Node.
