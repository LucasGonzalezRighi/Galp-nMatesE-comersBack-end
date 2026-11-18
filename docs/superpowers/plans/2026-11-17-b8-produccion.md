# B8 · Producción: plan

**Fecha:** 2026-11-17. **Parte de:** back `1058933`, front `c2a11fe`, los dos en `main`.

**Objetivo:** dejar la tienda, el dashboard y el back listos para publicar, con `audit_logs` del
dashboard, la pista 13 del front cerrada y una guía de despliegue que Lucas pueda seguir paso a paso.

## Lo que decidió Lucas (2026-11-17)

**Cambio de hosting, el mismo día.** Lo primero que se planeó y se construyó fue un VPS con Docker
(lo que sigue en este documento). Lucas escribió después que el front va a **Vercel** y el back a
**Render**, y esa es la decisión que vale. Lo del VPS queda hecho y probado como **camino
alternativo** (`docs/DESPLIEGUE-SERVIDOR-PROPIO.md`); el camino elegido está en la sección
"Vercel y Render" de más abajo y en `docs/DESPLIEGUE.md`.

| Tema             | Decisión final                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Hosting          | Tienda y dashboard en Vercel (dos proyectos del repo del front); back en Render.           |
| Postgres y Redis | En Render, junto al back (Render Postgres y Render Key Value), sin acceso desde internet.  |
| Planes           | Primero los gratis, para probar; los pagos más chicos para vender.                         |
| Dominio          | Todavía no lo tiene: sale con las direcciones gratis (`vercel.app` y `onrender.com`).      |

## Vercel y Render (el camino elegido)

```
Visitante ─► tienda en Vercel ────► back en Render ─► Postgres y Redis de Render
Lucas ────► dashboard en Vercel ──► back en Render
```

- **Render** se arma con un Blueprint (`render.yaml`): el back desde el `Dockerfile`, Render
  Postgres 17 y Render Key Value (sin desalojo, sin acceso externo), todo en la región Virginia,
  cerca de la región por omisión de las funciones de Vercel. Los nombres de los planes y los campos
  se validaron contra el esquema oficial de Render.
- **Migraciones y seed sin consola.** El plan gratis de Render no tiene consola ni comando previo
  al despliegue, así que la imagen aplica las migraciones al arrancar y, con `SEED_IF_EMPTY=true` y
  la base vacía, carga el catálogo y crea el admin (`ADMIN_EMAIL` y `ADMIN_PASSWORD`). Con datos no
  siembra. Los dos scripts (`seed` y `admin-password`) van compilados en la imagen.
- **La IP real del cliente.** `TRUST_PROXY` confía por dirección IP y en Vercel no sirve (sus IP de
  salida no son fijas, y Render no documenta su cadena de `X-Forwarded-For`). Se suma un secreto
  compartido: la tienda manda `x-galpon-proxy-secret` y la IP en `x-galpon-client-ip`, y el back
  solo le cree a quien trae el secreto (`TRUSTED_PROXY_SECRET`). Sin secreto válido, un pedido
  cuenta por la IP del socket: quien saltea la tienda comparte un solo cupo.
- **Cookies sin dominio propio.** Dashboard en `vercel.app` y back en `onrender.com` son sitios
  distintos y la cookie `__Host-` con `SameSite=Lax` no viaja. El proyecto del dashboard reenvía
  `/api/v1/admin/*` al back desde Vercel (`apps/admin/vercel.json`), así el navegador habla siempre
  con la dirección del dashboard. La tienda ya lo hacía con su rewrite de `/api/v1`.
- **Pista 13 en Vercel.** No hay disco propio: las páginas van a la caché de la plataforma. El tope
  de tamaño no arranca en Vercel y queda para el servidor propio.
- **Lo que no se puede probar sin las cuentas** está al final de `docs/DESPLIEGUE.md`.

## Camino alternativo: un VPS con Docker

Lo que sigue es el plan original. Está implementado y probado en esta máquina, pero **no es el
camino elegido**.

| Tema             | Decisión de ese camino                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| Hosting          | Un solo VPS Linux con Docker (tienda, dashboard y back en contenedores).              |
| Postgres y Redis | En el mismo servidor, en contenedores, sin salir a internet. Copia diaria de la base. |
| Dominio          | `tudominio.com.ar` como marcador, en un solo archivo.                                 |
| Proxy            | Sin Cloudflare: Caddy en el servidor, con HTTPS automático.                           |

### Cómo queda armado

```
Internet ──► Caddy (80/443, HTTPS) ──► tudominio.com.ar        ──► tienda (Next, 3000)  ──► back
                                   ──► admin.tudominio.com.ar  ──► dashboard (archivos estáticos)
                                   ──► api.tudominio.com.ar    ──► back (Nest, 3001) ──► Postgres, Redis
```

- **Un `docker compose`** en `backend/deploy/` levanta todo: `caddy`, `store`, `admin`, `api`,
  `postgres`, `redis` y `backup`. Solo Caddy publica puertos (80 y 443).
- **Variables:** un único `backend/deploy/.env` (con su `.env.example` comentado en español). De ahí
  salen las de cada app; los orígenes se arman solos a partir de `DOMAIN`.
- **IP real del cliente:** Caddy la escribe en `X-Real-IP`; la tienda la pasa al back
  (`TRUSTED_CLIENT_IP_HEADER=x-real-ip`, ya existe) y el back confía solo en la red interna de
  Docker (`TRUST_PROXY` con esa red, fijada en el compose). Lucas no tiene que configurar nada.
- **Back:** imagen con `dist` y dependencias de producción. Al arrancar corre
  `npx prisma migrate deploy` y después `node dist/main`. El seed es un comando aparte, a mano,
  con `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios.
- **Tienda:** se compila **dentro del contenedor al arrancar por primera vez** (cuando el back ya
  responde), porque `next build` lee el catálogo del back y deja fijos el rewrite y la CSP. Tarda
  unos minutos solo en el primer arranque de cada versión.
- **Dashboard:** se compila al construir la imagen y lo sirve un Caddy chico (archivos estáticos).
- **Salud:** `GET /api/v1/health` del back como `healthcheck` del contenedor; la tienda y el
  dashboard, con un pedido a una página estática. `restart: unless-stopped` en todos.
- **Logs:** los de Docker, con rotación por tamaño. **Copias:** `pg_dump` diario comprimido en
  `backend/deploy/backups/`, 14 días.

## Piezas (una por vez, en este orden)

### 1 · Back: `audit_logs` del dashboard

- Migración `audit_logs` (id, `actor_user_id`, `action`, `entity_type`, `entity_id`, `changes`
  jsonb, `created_at`; índice `(entity_type, entity_id)`), como en el diseño (§4 y §8).
- Módulo `audit` con un interceptor global: después de cada escritura **exitosa** del dashboard
  (`POST`/`PUT`/`PATCH`/`DELETE` de `/admin/*` con sesión de admin) guarda quién, qué y sobre qué.
  `changes` trae lo que mandó el dashboard y, de la fila principal, **solo las columnas que
  cambiaron** con su valor de antes y de después. Así no copia datos de clientes (un cambio de
  estado de un pedido guarda el estado, no el domicilio).
- No se auditan: login y logout (ya quedan en el log) ni la firma de fotos (no cambia datos). El
  cambio de contraseña del admin se anota sin contenido.
- Si falla el guardado de la auditoría, la escritura no se revierte: queda un error en el log.
- Sin cambios de contrato: no hay pantalla nueva; se consulta por SQL (va en la guía).
- Tests: unitarios del armado del registro y un E2E (una escritura del dashboard deja su fila; un
  4xx no deja nada).

### 2 · Back: ajustes de producción e imagen

- `ADMIN_ORIGIN` y `STORE_ORIGIN` obligatorias y explícitas con `NODE_ENV=production` (sin los
  valores de `localhost`).
- Pool de Postgres con `connectionTimeoutMillis` y `statement_timeout`.
- `Dockerfile` y `.dockerignore` del back; `backend/deploy/`: `docker-compose.yml`, `Caddyfile`,
  `.env.example` y el script de la copia diaria.
- Swagger sigue sin montarse en producción (más estricto que "protegido por sesión").
- `npm audit --omit=dev` en los dos repos: se anota el resultado, sin actualizar nada.

### 3 · Front: pista 13 y las imágenes

- **Pista 13, con tope de tamaño:** al arrancar y cada minuto, la tienda mide
  `.next/server/route-cache` y, si pasa de 256 MB, borra las páginas guardadas más viejas hasta
  quedar por debajo. Las otras dos opciones no sirven acá: `isrFlushToDisk: false` deja al
  optimizador de imágenes sin su caché de disco (cada foto se reprocesa en cada visita, y el VPS es
  chico) y `dynamicParams = false` obliga a recompilar la tienda por cada producto nuevo.
  Con su prueba: unitaria (la poda) y con la tienda compilada (pidiendo direcciones inventadas con
  un tope chico, la carpeta no lo pasa y las fichas reales siguen respondiendo).
- `Dockerfile` de la tienda y del dashboard y `.dockerignore` del front.

### 4 · Guía y documentación

- `backend/docs/DESPLIEGUE.md`: la guía del camino elegido, Vercel y Render, pantalla por pantalla y
  variable por variable. `backend/docs/DESPLIEGUE-SERVIDOR-PROPIO.md`: la del VPS con Docker (qué
  contratar, DNS, instalar Docker, clonar los dos repos, completar el `.env`, levantar, sembrar el
  admin, comprobar, actualizar, copias y restauración, logs y problemas frecuentes).
- `LANZAMIENTO-LEGAL.md` (proxy, migraciones, pista 13 y registros del servidor), `BITACORA.md`,
  los `README.md` de los dos repos y los `.env.example`.

### 5 · Verificación final (una sola)

- El compose levantado en esta máquina en modo producción, con puertos locales: back en el 3021,
  tienda en el 4410 y dashboard en el 5410 (sin Caddy con HTTPS, que necesita el dominio real).
- Suites completas. Back: `typecheck`, `lint`, `format:check`, `npm test`, `test:e2e` y
  `contract:check`. Front: `typecheck`, `lint`, `format:check`, `api:check`, `npm test` y las E2E
  con `--workers=2`.
- Commits locales en `main` de cada repo, sin pushear. Sin servidores, contenedores ni copias de
  trabajo abiertos.

## Lo que queda fuera de B8 (anotado, no se hace acá)

- Que el interceptor de idempotencia espere al pedido en curso en vez de responder 409, y los
  límites por sesión (cambian el comportamiento del checkout: van en una pieza propia).
- Verificación del email (NV-20) y formato del número de pedido (NV-15): piden cambio de contrato.
- Actualizar Next.js: decisión de Lucas, aparte.
- Un caché compartido entre instancias: solo hace falta con más de un servidor de la tienda.

## Lo que no se puede comprobar sin el hosting real

- El certificado HTTPS de Caddy y el DNS del dominio.
- Mercado Pago real (credenciales productivas, webhook firmado desde sus servidores).
- El envío real de mails por SMTP y las subidas reales a Cloudinary.
- Los tiempos de compilación y la memoria en el VPS elegido.
