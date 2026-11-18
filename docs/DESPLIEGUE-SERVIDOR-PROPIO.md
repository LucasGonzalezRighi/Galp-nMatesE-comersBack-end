# Camino alternativo: Galpón Mates en un servidor propio con Docker

> **Este no es el camino elegido.** Lucas decidió publicar el front en Vercel y el back en Render:
> la guía que hay que seguir es [`DESPLIEGUE.md`](DESPLIEGUE.md). Esta queda escrita, y probada en
> una compu, por si algún día conviene pasar todo a un servidor propio.

Paso a paso para publicar la tienda, el dashboard y el back en **un servidor propio (VPS) con
Docker**. Está pensada para seguirla de arriba hacia abajo una sola vez; después, para actualizar,
alcanza con la sección [Actualizar](#9-actualizar-a-una-versión-nueva).

Lo legal y lo que depende del dueño, del abogado y del contador está en
[`LANZAMIENTO-LEGAL.md`](LANZAMIENTO-LEGAL.md). Esta guía es solo la parte técnica.

## Cómo queda armado

```
Internet ─► Caddy (HTTPS) ─► tudominio.com.ar        ─► tienda (Next.js)  ─► back
                          ─► admin.tudominio.com.ar  ─► dashboard
                          ─► api.tudominio.com.ar    ─► back (NestJS) ─► Postgres y Redis
```

Todo corre en contenedores de Docker dentro del mismo servidor, con un solo comando
(`docker compose`). Las piezas:

| Contenedor | Qué hace                                                                       |
| ---------- | ------------------------------------------------------------------------------ |
| `caddy`    | La puerta de entrada. Saca y renueva solo los certificados HTTPS.              |
| `store`    | La tienda. Se compila sola la primera vez que arranca cada versión.            |
| `admin`    | El dashboard (archivos estáticos).                                             |
| `api`      | El back. Al arrancar aplica las migraciones de la base.                        |
| `postgres` | La base de datos. No sale a internet.                                          |
| `redis`    | Colas (mails, vencimiento de pedidos), sesiones y límites. No sale a internet. |
| `backup`   | Una copia de la base por día, en `backend/deploy/backups/`.                    |

Los archivos del despliegue están en `backend/deploy/`: `docker-compose.yml`, `Caddyfile`,
`.env.example` y `backup.sh`.

## Lo que tenés que conseguir antes de empezar

- [ ] **Un VPS con Linux** (Ubuntu 24.04 LTS), con IP pública fija. Mínimo 2 núcleos, **4 GB de
      RAM** y 40 GB de disco (las imágenes de Docker ocupan unos 5 GB). Con 2 GB de RAM también
      anda, pero hay que agregarle memoria de intercambio (paso 2), porque la tienda se compila en
      el servidor.
- [ ] **El dominio** (por ejemplo `tudominio.com.ar`) y acceso al panel donde se cargan sus
      registros DNS.
- [ ] **Mercado Pago:** la aplicación creada en el panel de desarrolladores, con las credenciales
      de producción activadas.
- [ ] **Un servicio de envío de mails** que dé datos SMTP (servidor, puerto, usuario y contraseña),
      con el dominio verificado.
- [ ] **Una cuenta de Cloudinary** (las fotos que se suben desde el dashboard).
- [ ] **Los dos repos** (`frontend` y `backend`) subidos a GitHub, con todo lo último en `main`.

En toda la guía, donde dice `tudominio.com.ar` va tu dominio real.

## 1. DNS: apuntar el dominio al servidor

En el panel del DNS creá cuatro registros de tipo **A**, todos con la IP pública del VPS:

| Nombre  | Queda como               | Para qué                           |
| ------- | ------------------------ | ---------------------------------- |
| `@`     | `tudominio.com.ar`       | La tienda                          |
| `www`   | `www.tudominio.com.ar`   | Redirige a la tienda               |
| `admin` | `admin.tudominio.com.ar` | El dashboard                       |
| `api`   | `api.tudominio.com.ar`   | El back (dashboard y Mercado Pago) |

Los cambios de DNS pueden tardar desde unos minutos hasta algunas horas. Para comprobarlo desde tu
compu (tiene que responder la IP del VPS):

```bash
nslookup api.tudominio.com.ar
```

No sigas con el paso 6 hasta que los cuatro nombres respondan: Caddy necesita que el dominio ya
apunte al servidor para sacar los certificados.

## 2. Preparar el servidor

Entrá por SSH al VPS y corré esto, de a un bloque.

**Actualizar el sistema:**

```bash
sudo apt update && sudo apt upgrade -y
```

**Instalar Docker** (el instalador oficial; trae `docker compose`):

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Cerrá la sesión de SSH y volvé a entrar para que tome el grupo. Comprobá:

```bash
docker compose version
```

**Cortafuegos:** dejar abiertos solo SSH, HTTP y HTTPS.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

**Memoria de intercambio** (solo si el VPS tiene menos de 4 GB de RAM):

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Bajar el código

Los dos repos van **uno al lado del otro**, con esos nombres de carpeta (el compose los busca así):

```bash
sudo mkdir -p /opt/galpon && sudo chown $USER /opt/galpon && cd /opt/galpon
```

```bash
git clone https://github.com/LucasGonzalezRighi/Galp-nMatesE-comersFront-End.git frontend
```

```bash
git clone https://github.com/LucasGonzalezRighi/Galp-nMatesE-comersBack-end.git backend
```

Si los repos son privados, GitHub pide usuario y un token de acceso personal (Settings → Developer
settings → Personal access tokens, con permiso de lectura de los repos). Antes de clonar, fijate que
en GitHub esté subido lo último de `main` de los dos (primero el front, después el back).

## 4. Completar el archivo `.env`

```bash
cd /opt/galpon/backend/deploy && cp .env.example .env && nano .env
```

El archivo está comentado línea por línea. Lo que va en cada una:

### Dominio

- `DOMAIN`: el dominio pelado, sin `https://` ni `www` (`tudominio.com.ar`).
- `ACME_EMAIL`: tu mail. Solo se usa para avisarte si un certificado está por vencer.

### Secretos que inventás vos

Generalos en el servidor y pegalos en el `.env`:

```bash
openssl rand -hex 24
```

Ese va en `POSTGRES_PASSWORD` (la contraseña de la base).

```bash
openssl rand -hex 32
```

Ese va en `REVALIDATE_SECRET` (el secreto con el que el back le avisa a la tienda que regenere una
página).

### Mercado Pago

En [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers) → **Tus
integraciones** → tu aplicación:

1. **Credenciales de producción.** Copiá la **Public Key** a `MP_PUBLIC_KEY` y el **Access Token**
   a `MP_ACCESS_TOKEN`. Las dos empiezan con `APP_USR-`. Tienen que ser de la **misma aplicación**.
2. **Webhooks → Configurar notificaciones → Modo productivo.**
   - URL: `https://api.tudominio.com.ar/api/v1/webhooks/mercadopago`
   - Evento: **Pagos**.
   - Guardá. Mercado Pago muestra una **clave secreta**: copiala a `MP_WEBHOOK_SECRET`.
3. `MP_STATEMENT_DESCRIPTOR`: el texto que ve el cliente en el resumen de su tarjeta (hasta 13
   caracteres). Viene `GALPON MATES`.

Confirmá además en la cuenta de Mercado Pago las **cuotas sin interés** que promete la tienda (está
en `LANZAMIENTO-LEGAL.md`).

### Cloudinary

En el panel de Cloudinary → **Settings → API Keys**: copiá el nombre de la nube a
`CLOUDINARY_CLOUD_NAME`, la API Key a `CLOUDINARY_API_KEY` y el API Secret a
`CLOUDINARY_API_SECRET`.

### Mails (SMTP)

Del servicio de envío de mails que contrates:

- `SMTP_HOST`, `SMTP_PORT` (587 o 465), `SMTP_USER` y `SMTP_PASS`: los datos SMTP que te da.
- `MAIL_FROM`: el remitente, **con comillas**: `"Galpón Mates <hola@tudominio.com.ar>"`. La
  dirección tiene que ser de un dominio verificado en ese servicio.
- En el panel del servicio, verificá el dominio y cargá en el DNS los registros **SPF** y **DKIM**
  que te indique. Sin eso los mails caen en spam.

### Lo que no hay que tocar

Las direcciones de la tienda, del dashboard y del back, el proxy de confianza (`TRUST_PROXY`) y las
conexiones a la base y a Redis **se arman solas** a partir de `DOMAIN`. No hay que cargarlas.

## 5. Crear la base y el admin del dashboard

Primero se levantan la base y el back, que al arrancar crea las tablas
(`npx prisma migrate deploy` corre solo, cada vez que arranca):

```bash
cd /opt/galpon/backend/deploy && docker compose up -d --build api
```

La primera vez tarda varios minutos (baja las imágenes y compila el back). Comprobá que quedó sano:

```bash
docker compose ps
```

`api`, `postgres` y `redis` tienen que decir `healthy`. Si `api` se reinicia, mirá por qué:

```bash
docker compose logs api
```

Si falta una variable o tiene un valor inválido, el mensaje dice cuál.

**El seed** carga el catálogo inicial (líneas, productos, combos, textos y ajustes) y crea **tu
usuario del dashboard**. En el `.env`, sacale el `#` a las dos últimas líneas y completalas:

```
ADMIN_EMAIL=tu-mail@tudominio.com.ar
ADMIN_PASSWORD=una-contraseña-larga-de-12-o-más
```

Y corré:

```bash
docker compose --profile tools run --rm tools npm run db:seed
```

Cuando termine, **borrá esas dos líneas del `.env`** (la contraseña ya quedó guardada cifrada en la
base).

**El seed se corre una sola vez.** Si lo repetís más adelante, devuelve las líneas, los productos,
las reseñas y los combos del catálogo inicial a sus valores de fábrica: pisa los cambios que les
hayas hecho desde el dashboard (los textos, los ajustes y los envíos no los toca). Para cambiar la
contraseña del admin no hace falta el seed: ver "Me olvidé la contraseña" en la sección 10.

## 6. Levantar todo

Con el DNS ya respondiendo (paso 1):

```bash
cd /opt/galpon/backend/deploy && docker compose up -d --build
```

- La **tienda se compila dentro de su contenedor** la primera vez: tarda entre 3 y 10 minutos
  según el servidor. Mientras tanto la tienda responde un error 502; es normal. Para verla avanzar:

  ```bash
  docker compose logs -f store
  ```

  Cuando aparece `Tienda compilada.` y después `Ready`, ya está.

- Caddy saca los certificados HTTPS solo, en el primer minuto.

## 7. Comprobar que anda

```bash
docker compose ps
```

Todos tienen que estar `Up`, y `api`, `store`, `admin`, `postgres` y `redis` en `healthy`.

```bash
curl https://api.tudominio.com.ar/api/v1/health
```

Tiene que responder `"status":"ok"`.

Después, a mano, desde el navegador:

- [ ] `https://tudominio.com.ar` muestra la tienda con los productos, y el candado de HTTPS.
- [ ] `https://www.tudominio.com.ar` redirige a la tienda.
- [ ] `https://admin.tudominio.com.ar` abre el dashboard y entra con tu `ADMIN_EMAIL` y tu
      contraseña.
- [ ] En el dashboard, **Ajustes**: cargá los datos del vendedor (razón social, CUIT, domicilio,
      etc.). Guardá y mirá que el pie de la tienda los muestre en menos de un minuto.
- [ ] Subí una foto a un producto desde el dashboard (prueba Cloudinary) y mirá que la tienda la
      muestre.
- [ ] Mandá un mensaje desde **Contacto** en la tienda: tiene que llegarte el mail de confirmación
      (prueba el SMTP).
- [ ] **Una compra real** de un producto barato con tu tarjeta: el pedido tiene que pasar a
      "Pagado" en el dashboard y tienen que llegar los dos mails (pedido recibido y pago aprobado).
      Después devolvé la plata desde Mercado Pago.
- [ ] En **Mercado Pago → Webhooks**, la última notificación figura entregada (código 200).

## 8. El día a día

**Ver los logs** (los últimos, y seguir en vivo):

```bash
docker compose logs --tail 100 -f api
```

Cambiá `api` por `store`, `caddy`, `admin`, `postgres`, `redis` o `backup`. Cada contenedor guarda
hasta 50 MB de logs (5 archivos de 10 MB); cuando se llena, pisa lo más viejo.

**Reiniciar algo que quedó raro:**

```bash
docker compose restart api
```

**Apagar y prender todo** (los datos no se pierden: viven en volúmenes de Docker):

```bash
docker compose down
```

```bash
docker compose up -d
```

Nunca uses `docker compose down -v`: la `-v` **borra la base de datos**.

**Si el servidor se reinicia,** todo vuelve a levantar solo.

### Copias de la base

El contenedor `backup` guarda una copia por día en `/opt/galpon/backend/deploy/backups/`
(`galpon-AAAA-MM-DD_HHMM.dump`) y borra las de más de 14 días (`BACKUP_KEEP_DAYS`).

Esas copias están **en el mismo servidor**: si se rompe el disco, se pierden con todo lo demás.
Bajate una a tu compu cada tanto (por ejemplo, una por semana). Desde tu compu:

```bash
scp usuario@IP-DEL-VPS:/opt/galpon/backend/deploy/backups/galpon-2026-12-01_0300.dump .
```

**Hacer una copia ahora** (antes de una actualización, por ejemplo):

```bash
docker compose exec backup sh -c 'pg_dump --format=custom --no-owner --file=/backups/galpon-manual-$(date +%Y-%m-%d_%H%M).dump'
```

**Restaurar una copia** (pisa todo lo que haya en la base):

```bash
docker compose stop api store
```

```bash
docker compose exec backup pg_restore --clean --if-exists --no-owner --dbname=galpon /backups/galpon-2026-12-01_0300.dump
```

```bash
docker compose start api store
```

### Quién cambió qué en el dashboard

Cada cambio hecho desde el dashboard queda anotado en la tabla `audit_logs` (quién, qué, sobre qué
y el antes y el después de lo que cambió). Para ver los últimos 20:

```bash
docker compose exec postgres psql -U galpon -d galpon -c "SELECT a.created_at, u.email, a.action, a.entity_type, a.entity_id FROM audit_logs a JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 20;"
```

Y el detalle de los cambios de un producto, un pedido o lo que sea (con su tipo y su id):

```bash
docker compose exec postgres psql -U galpon -d galpon -c "SELECT created_at, action, jsonb_pretty(changes) FROM audit_logs WHERE entity_type = 'order' AND entity_id = 'GLP-10001' ORDER BY created_at;"
```

## 9. Actualizar a una versión nueva

Cuando haya cambios nuevos en GitHub:

```bash
cd /opt/galpon/frontend && git pull
```

```bash
cd /opt/galpon/backend && git pull
```

```bash
cd /opt/galpon/backend/deploy && docker compose up -d --build
```

- El back aplica solo las migraciones nuevas al arrancar.
- Si cambió el front, **la tienda se vuelve a compilar** (unos minutos con error 502). Conviene
  hacerlo en un horario de poco movimiento.
- Si cambiaste algo del `.env`, el mismo comando lo toma.

Para liberar el espacio de las imágenes viejas, cada tanto:

```bash
docker image prune -f
```

## 10. Problemas frecuentes

| Qué pasa                                            | Qué mirar                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El navegador dice que el sitio no es seguro         | El DNS todavía no apunta al VPS o los puertos 80 y 443 están cerrados. `docker compose logs caddy` dice qué nombre no pudo validar. Caddy reintenta solo.                                                    |
| `api` se reinicia todo el tiempo                    | `docker compose logs api`: si es una variable del `.env`, el mensaje la nombra. Corregila y `docker compose up -d`.                                                                                          |
| La tienda da 502 mucho tiempo                       | `docker compose logs store`. Si se corta compilando y dice `Killed` o falta de memoria, agregá la memoria de intercambio del paso 2.                                                                         |
| La tienda no muestra un cambio del dashboard        | Tarda hasta un minuto. Si no aparece, `docker compose logs api` y buscá el aviso a la tienda; revisá que `REVALIDATE_SECRET` no tenga espacios.                                                              |
| No llegan los mails                                 | `docker compose logs api`, buscá `mail`. Revisá `SMTP_*` y `MAIL_FROM`, y el SPF y el DKIM del dominio. Los mails se reintentan solos 5 veces.                                                               |
| El pedido no pasa a "Pagado"                        | En Mercado Pago → Webhooks, mirá si la notificación dio error. Un 401 es `MP_WEBHOOK_SECRET` mal copiada. Igual el back consulta los pagos pendientes por su cuenta a los minutos.                           |
| No se pueden subir fotos                            | Revisá las tres `CLOUDINARY_*` (sin espacios ni comillas).                                                                                                                                                   |
| Me olvidé la contraseña del dashboard               | Poné `ADMIN_EMAIL` (el tuyo) y `ADMIN_PASSWORD` (la nueva) en el `.env` y corré `docker compose --profile tools run --rm tools npm run admin:password`. Después borrá las dos líneas. **No corras el seed.** |
| "Demasiados intentos" a todos los clientes a la vez | El back no está viendo la IP real. `docker compose logs caddy` y revisá que no haya otro proxy delante. Si sumás Cloudflare, mirá la sección siguiente.                                                      |

## 11. Si más adelante sumás Cloudflare

Hoy el compose está pensado **sin** Cloudflare delante: Caddy recibe a los visitantes directo y
anota su IP real. Si algún día activás el proxy de Cloudflare (la nube naranja), todos los
visitantes le llegan a Caddy con las IP de Cloudflare y los límites por cliente dejan de servir.
Para arreglarlo hay que decirle a Caddy que confíe en los rangos de Cloudflare
(`trusted_proxies` en las opciones globales del `Caddyfile`). Es un cambio chico, pero no lo
actives sin hacerlo.

## 12. Ensayo en tu compu (opcional)

Para probar el compose antes de pagar un servidor, con Docker Desktop abierto:

```bash
cd backend/deploy && cp .env.example .env
```

Completá el `.env` con `DOMAIN=localhost` y el resto de los valores (para un ensayo sirven las
credenciales **de prueba** de Mercado Pago). Después:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build api
```

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile tools run --rm tools npm run db:seed
```

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Queda el back en `http://localhost:3021`, la tienda en `http://localhost:4410` y el dashboard en
`http://localhost:5410`. No hay Caddy ni HTTPS (necesitan un dominio real), y Mercado Pago no puede
avisar los pagos a `localhost`. Para apagarlo y borrar todo lo del ensayo:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v
```

## Lo que se probó y lo que no

El 2026-11-17 se levantó este mismo compose en una compu, en modo producción y con credenciales
falsas (el ensayo de la sección 12). Lo que se vio andar:

- Las imágenes se construyen y los seis contenedores quedan sanos; el back corre sin permisos de
  administrador dentro de su contenedor.
- El back aplica solo las 15 migraciones al arrancar. Swagger y el simulador de pagos no existen en
  producción (responden 404).
- El seed con `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios carga el catálogo y crea el admin.
- La tienda se compila sola dentro de su contenedor contra el back (27 segundos en esa compu; en un
  VPS chico, varios minutos) y, al reiniciarla, no vuelve a compilar.
- El dashboard se sirve con sus cabeceras de seguridad y entra con el admin sembrado; una edición
  de una línea queda en `audit_logs` con el antes y el después, el back le avisa a la tienda por la
  red interna y la tienda muestra el cambio.
- Los límites cuentan por la IP real: un cliente bloqueado por exceso de intentos no bloquea a
  otro, y no puede saltear el límite inventando una IP.
- La copia diaria de la base se hace y se restaura.
- `npm run admin:password` cambia la contraseña del admin sin tocar el catálogo.
- El `Caddyfile` es válido para los cuatro nombres (`caddy validate`).

**No se pudo probar sin el servidor y las cuentas reales:**

- El certificado HTTPS de Caddy y el DNS (necesitan el dominio).
- Los pagos reales y el webhook de Mercado Pago llegando desde sus servidores.
- El envío real de mails por SMTP y las subidas reales a Cloudinary.
- Cuánto tarda en compilar la tienda y cuánta memoria usa en el VPS que elijas.

Por eso el paso 7 no es opcional: es la primera vez que esas cuatro cosas se prueban de verdad.
