# Guía de despliegue de Galpón Mates: Render (y Vercel)

Paso a paso para publicar la tienda y el dashboard en **Vercel** y el back en **Render**. Está
pensada para seguirla de arriba hacia abajo una sola vez. No hace falta saber de servidores: son
pantallas y variables.

> **La mudanza a Render.** Ya está decidido pasar todo a Render, con el dominio
> `galponmates.com.ar`: la sección 13, ["Todo en Render con el dominio
> propio"](#13-todo-en-render-con-el-dominio-propio), lo hace paso a paso a partir de lo que ya
> está publicado. Las secciones 1 a 12 cuentan cómo se publicó la prueba en Vercel y siguen
> valiendo para el back.

- Lo legal y lo que depende del dueño, del abogado y del contador está en
  [`LANZAMIENTO-LEGAL.md`](LANZAMIENTO-LEGAL.md).
- Existe otro camino, con un servidor propio y Docker: está en
  [`DESPLIEGUE-SERVIDOR-PROPIO.md`](DESPLIEGUE-SERVIDOR-PROPIO.md). **No es el camino elegido**;
  queda escrito por si algún día hace falta.

## Cómo queda armado

```
Visitante ─► tienda en Vercel ──────────────► back en Render ─► Postgres y Redis de Render
Vos ──────► dashboard en Vercel ────────────► back en Render
Mercado Pago ───────────────────────────────► back en Render (aviso de cada pago)
```

| Pieza     | Dónde vive                             | De qué repo sale                 |
| --------- | -------------------------------------- | -------------------------------- |
| Tienda    | Vercel, proyecto `galpon-mates`        | front, carpeta `apps/store`      |
| Dashboard | Vercel, proyecto `galpon-mates-admin`  | front, carpeta `apps/admin`      |
| Back      | Render, servicio `galpon-mates-api`    | back (usa el `Dockerfile`)       |
| Base      | Render Postgres, `galpon-mates-db`     | la crea el archivo `render.yaml` |
| Redis     | Render Key Value, `galpon-mates-redis` | la crea el archivo `render.yaml` |

El navegador **nunca habla directo con Render**: la tienda y el dashboard le reenvían los pedidos
al back desde Vercel. Por eso todo funciona con las direcciones gratis (`vercel.app` y
`onrender.com`), sin dominio propio.

**No hay que correr `npm install` ni migraciones a mano en producción.** Render instala, compila y,
cada vez que arranca el back, aplica las migraciones (`npx prisma migrate deploy`). La primera vez,
con la base vacía, también carga el catálogo y crea tu usuario del dashboard. Vercel instala y
compila solo. Los comandos para trabajar en tu compu están al final (sección 12).

## Gratis para probar, pago para vender

Elegiste **probar gratis primero**. Así como está el repo, todo se crea en los planes gratis. Sirve
para mirar que todo anda, con estos límites:

| Límite del plan gratis                                         | Qué significa                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| El back se duerme a los 15 minutos sin visitas                 | La primera visita después tarda alrededor de un minuto. Dormido no vence pedidos ni manda mails. |
| La base gratis se borra a los 30 días                          | Render avisa por mail antes. Si pasás al plan pago, no se borra.                                 |
| El Redis gratis no guarda nada en disco                        | Si se reinicia, se pierden los mails y avisos que estaban en cola.                               |
| Render gratis bloquea los puertos de mail 465 y 587            | Los mails solo salen si tu servicio de mails acepta el puerto **2525** (muchos lo aceptan).      |
| Render gratis no tiene consola                                 | No se puede cambiar la contraseña del admin por comando (sección 9).                             |
| Vercel gratis (Hobby) es solo para uso personal o no comercial | Para vender hace falta el plan Pro de Vercel.                                                    |

Para salir a vender hay que pasar a los planes pagos más chicos (sección 10). Son tres líneas de un
archivo y un clic en Vercel; no hay que rehacer nada.

## 1. Lo que tenés que tener antes de empezar

**Cuentas** (todas se crean gratis):

- [ ] **GitHub**, con los dos repos subidos y lo último en `main` (primero el front, después el back).
- [ ] **Render** ([render.com](https://render.com)): entrá con tu cuenta de GitHub.
- [ ] **Vercel** ([vercel.com](https://vercel.com)): entrá con tu cuenta de GitHub.
- [ ] **Mercado Pago**, con una aplicación creada en
      [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers).
- [ ] **Cloudinary** ([cloudinary.com](https://cloudinary.com)), para las fotos del dashboard.
- [ ] **Un servicio de envío de mails** que dé datos SMTP (servidor, puerto, usuario y contraseña).
      Para la prueba gratis, uno que acepte el puerto 2525.

**Los nombres.** La guía usa estos tres. Si al crear algo la plataforma te avisa que el nombre está
tomado y te da otra dirección, **anotá la dirección real** y usala en todos los pasos (la sección 6
dice qué tocar).

| Qué       | Nombre               | Dirección que debería quedar            |
| --------- | -------------------- | --------------------------------------- |
| Back      | `galpon-mates-api`   | `https://galpon-mates-api.onrender.com` |
| Tienda    | `galpon-mates`       | `https://galpon-mates.vercel.app`       |
| Dashboard | `galpon-mates-admin` | `https://galpon-mates-admin.vercel.app` |

**Los datos.** Juntalos en un archivo de texto en tu compu (no en el repo) antes de arrancar:

| Dato                               | De dónde sale                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Access Token de Mercado Pago       | Paso 2.                                                                                                              |
| Public Key de Mercado Pago         | Paso 2.                                                                                                              |
| Clave secreta del webhook          | Paso 2.                                                                                                              |
| Cloud name, API Key y API Secret   | Panel de Cloudinary → **Settings → API Keys**.                                                                       |
| Servidor, puerto, usuario y clave  | Los datos SMTP de tu servicio de mails.                                                                              |
| Remitente de los mails             | Por ejemplo `Galpón Mates <hola@tudominio.com.ar>`. La dirección tiene que estar verificada en el servicio de mails. |
| Tu email y tu contraseña del admin | Los inventás vos. La contraseña, de 12 caracteres o más.                                                             |

## 2. Mercado Pago: credenciales y webhook

En [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers) → **Tus
integraciones** → tu aplicación.

1. **Credenciales.** Para la prueba gratis usá las **credenciales de prueba**; para vender, las
   **de producción**. Copiá la **Public Key** y el **Access Token** (las dos empiezan con
   `APP_USR-`). Tienen que ser de la misma aplicación.
2. **Webhooks → Configurar notificaciones.**
   - URL: `https://galpon-mates-api.onrender.com/api/v1/webhooks/mercadopago`
   - Evento: **Pagos**.
   - Guardá. Mercado Pago muestra una **clave secreta**: copiala.

Con credenciales de prueba se configura la pestaña "Modo pruebas"; con las de producción, "Modo
productivo". Confirmá además en la cuenta las **cuotas sin interés** que promete la tienda (está en
`LANZAMIENTO-LEGAL.md`).

## 3. Render: el back, la base y el Redis

El archivo `render.yaml` del repo del back le dice a Render qué crear. Se hace todo de una vez.

1. En [dashboard.render.com](https://dashboard.render.com): **New → Blueprint**.
2. Conectá tu cuenta de GitHub si te lo pide y elegí **el repo del back**. Clic en **Connect**.
3. Nombre del Blueprint: `galpon-mates`. Rama: `main`. Lo demás, como viene.
4. Render lee el archivo y te muestra lo que va a crear (`galpon-mates-api`, `galpon-mates-redis` y
   `galpon-mates-db`) y te pide estos valores. Cargalos **sin comillas y sin espacios de más**:

| Variable                | Qué poner                                                      |
| ----------------------- | -------------------------------------------------------------- |
| `STORE_ORIGIN`          | `https://galpon-mates.vercel.app`                              |
| `ADMIN_ORIGIN`          | `https://galpon-mates-admin.vercel.app`                        |
| `PUBLIC_API_ORIGIN`     | `https://galpon-mates-api.onrender.com`                        |
| `MP_ACCESS_TOKEN`       | El Access Token de Mercado Pago.                               |
| `MP_WEBHOOK_SECRET`     | La clave secreta del webhook.                                  |
| `CLOUDINARY_CLOUD_NAME` | El nombre de la nube de Cloudinary.                            |
| `CLOUDINARY_API_KEY`    | La API Key de Cloudinary.                                      |
| `CLOUDINARY_API_SECRET` | El API Secret de Cloudinary.                                   |
| `SMTP_HOST`             | El servidor SMTP.                                              |
| `SMTP_PORT`             | En la prueba gratis, `2525`. En el plan pago, `587` (o `465`). |
| `SMTP_USER`             | El usuario SMTP.                                               |
| `SMTP_PASS`             | La contraseña SMTP.                                            |
| `MAIL_FROM`             | `Galpón Mates <hola@tudominio.com.ar>` (así, sin comillas).    |
| `ADMIN_EMAIL`           | Tu email para entrar al dashboard.                             |
| `ADMIN_PASSWORD`        | Tu contraseña del dashboard, de 12 caracteres o más.           |

5. Clic en **Deploy Blueprint** (o **Apply**). Render crea la base y el Redis, construye el back
   (la primera vez tarda entre 5 y 10 minutos) y lo arranca.
6. Entrá al servicio `galpon-mates-api` → **Logs**. Tenés que ver, en este orden, que se aplican
   las migraciones, una línea que empieza con `Seed listo:` (cargó el catálogo y creó tu admin) y
   `Nest application successfully started`.
7. Arriba, debajo del nombre del servicio, está su dirección. Abrí en el navegador
   `https://galpon-mates-api.onrender.com/api/v1/health`: tiene que responder `"status":"ok"`.
8. **Copiá dos valores** que inventó Render: en `galpon-mates-api` → **Environment**, mostrá y
   copiá a tu archivo de texto `STORE_REVALIDATE_SECRET` y `TRUSTED_PROXY_SECRET`. Los vas a pegar
   en Vercel.

Si el servicio no arranca, el log dice qué variable falta o está mal. Se corrige en
**Environment** → **Save, rebuild, and deploy**.

Ya con el admin creado podés borrar `ADMIN_PASSWORD` de **Environment** (la contraseña quedó
guardada cifrada en la base). No es obligatorio: mientras la base tenga datos, no se vuelve a usar.

## 4. Vercel: la tienda

Antes de empezar, abrí `https://galpon-mates-api.onrender.com/api/v1/health` y esperá a que
responda: en el plan gratis el back puede estar dormido, y la tienda lo necesita despierto para
compilar.

1. En [vercel.com](https://vercel.com): **Add New… → Project**.
2. **Import** del **repo del front**.
3. **Project Name:** `galpon-mates`.
4. **Root Directory:** clic en **Edit** y elegí `apps/store`. Vercel detecta **Next.js** solo.
5. Abrí **Environment Variables** y cargá estas nueve:

| Nombre                              | Valor                                                |
| ----------------------------------- | ---------------------------------------------------- |
| `API_MODE`                          | `live`                                               |
| `NEXT_PUBLIC_API_MODE`              | `live`                                               |
| `API_BASE_URL`                      | `https://galpon-mates-api.onrender.com`              |
| `NEXT_PUBLIC_SITE_URL`              | `https://galpon-mates.vercel.app`                    |
| `REVALIDATE_SECRET`                 | El `STORE_REVALIDATE_SECRET` que copiaste de Render. |
| `API_PROXY_SECRET`                  | El `TRUSTED_PROXY_SECRET` que copiaste de Render.    |
| `TRUSTED_CLIENT_IP_HEADER`          | `x-real-ip`                                          |
| `NEXT_PUBLIC_MP_PUBLIC_KEY`         | La Public Key de Mercado Pago.                       |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | El nombre de la nube de Cloudinary.                  |

6. Clic en **Deploy**. Tarda unos minutos. Si falla, el log del build dice qué variable corregir
   (en español); se cambia en **Settings → Environment Variables** y se vuelve a desplegar desde
   **Deployments → ⋯ → Redeploy**.
7. Cuando termine, Vercel muestra la dirección de la tienda. Tiene que ser
   `https://galpon-mates.vercel.app`.

## 5. Vercel: el dashboard

1. **Add New… → Project** y otra vez **Import** del **mismo repo del front**.
2. **Project Name:** `galpon-mates-admin`.
3. **Root Directory:** `apps/admin`. Vercel detecta **Vite** solo.
4. **Environment Variables:**

| Nombre              | Valor                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `VITE_API_MODE`     | `live`                                                               |
| `VITE_API_BASE_URL` | `https://galpon-mates-admin.vercel.app` (la dirección del dashboard) |
| `VITE_STORE_URL`    | `https://galpon-mates.vercel.app`                                    |
| `API_PROXY_SECRET`  | El `TRUSTED_PROXY_SECRET` que copiaste de Render.                    |

5. **Deploy**.

`VITE_API_BASE_URL` es la dirección **del propio dashboard**, no la de Render: el archivo
`apps/admin/vercel.json` hace que todo lo que el dashboard pide en `/api/v1/admin/…` Vercel se lo
reenvíe al back. Así el navegador guarda la sesión en la dirección del dashboard y no hace falta un
dominio propio.

## 6. Si alguna dirección no quedó como la de la guía

| Cambió la dirección de… | Qué tocar                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El back en Render       | En Render: `PUBLIC_API_ORIGIN`. En Vercel (tienda): `API_BASE_URL`. En Mercado Pago: la URL del webhook. En el repo del front: la línea `"dest"` de `apps/admin/vercel.json` (y subir el cambio a GitHub). |
| La tienda en Vercel     | En Render: `STORE_ORIGIN`. En Vercel (tienda): `NEXT_PUBLIC_SITE_URL`. En Vercel (dashboard): `VITE_STORE_URL`.                                                                                            |
| El dashboard en Vercel  | En Render: `ADMIN_ORIGIN`. En Vercel (dashboard): `VITE_API_BASE_URL`.                                                                                                                                     |

Después de cambiar una variable en Vercel hay que volver a desplegar ese proyecto (**Deployments →
⋯ → Redeploy**): varias quedan fijas al compilar. En Render, **Save, rebuild, and deploy**.

## 7. Comprobar que anda

- [ ] `https://galpon-mates-api.onrender.com/api/v1/health` responde `"status":"ok"`.
- [ ] `https://galpon-mates.vercel.app` muestra la tienda con los productos.
- [ ] `https://galpon-mates-admin.vercel.app` abre el dashboard y **entra** con tu `ADMIN_EMAIL` y
      tu contraseña. Recargá la página: tiene que seguir adentro.
- [ ] En el dashboard, **Ajustes**: cargá los datos del vendedor y guardá. En menos de un minuto el
      pie de la tienda los muestra (prueba el aviso del back a la tienda).
- [ ] Subí una foto a un producto desde el dashboard (prueba Cloudinary) y mirá que la tienda la
      muestre.
- [ ] En la tienda, creá una cuenta y mandá un mensaje desde **Contacto**: tienen que llegar los
      mails (prueba el SMTP).
- [ ] **Una compra.** Con credenciales de prueba, usá una tarjeta de prueba de Mercado Pago (están
      en el README del back, "Sandbox de Mercado Pago"); con las de producción, un producto barato
      con tu tarjeta, y después devolvé la plata desde Mercado Pago. El pedido tiene que pasar a
      "Pagado" en el dashboard.
- [ ] En **Mercado Pago → Webhooks**, la última notificación figura entregada (código 200).
- [ ] **Los límites cuentan por cliente.** En la tienda, probá entrar a una cuenta con una
      contraseña equivocada más de 20 veces seguidas: tiene que aparecer el aviso de demasiados
      intentos. Desde otra conexión (el celular con datos, sin wifi) la tienda tiene que seguir
      dejando intentar. Si se bloquea para todos a la vez, revisá que `API_PROXY_SECRET` en Vercel
      sea igual a `TRUSTED_PROXY_SECRET` en Render y que `TRUSTED_CLIENT_IP_HEADER` sea `x-real-ip`.

## 8. Actualizar a una versión nueva

Alcanza con subir los cambios a GitHub (`main`): **Render y Vercel vuelven a desplegar solos**.

- El back aplica las migraciones nuevas al arrancar. Si falla, Render deja andando la versión
  anterior y lo muestra en **Events**.
- Subí **primero el back** si el cambio toca el contrato entre los dos, y esperá a que termine
  antes de subir el front: la tienda lee del back al compilar.

## 9. El día a día

**Logs.** En Render: servicio `galpon-mates-api` → **Logs** (se guardan 7 días en el plan de cuenta
Hobby de Render). En Vercel: proyecto → **Logs** (1 hora en Hobby, 1 día en Pro).

**Copias de la base.** En el plan pago, Render guarda la base y permite volver a cualquier momento
de los últimos días (**Recovery** en la página de la base; 3 días en la cuenta Hobby). En el plan
gratis **no hay copias**.

**Cambiar la contraseña del admin** (o crear otro). Estando adentro, se cambia desde el dashboard.
Si la olvidaste, en el plan pago: servicio `galpon-mates-api` → **Shell**, y:

```bash
ADMIN_EMAIL='tu-mail@ejemplo.com' ADMIN_PASSWORD='la-contraseña-nueva' npm run admin:password:prod
```

No toca el catálogo. En el plan gratis no hay consola: durante la prueba, lo más simple es borrar la
base desde Render y volver a crearla con el Blueprint.

**Quién cambió qué en el dashboard.** Cada cambio queda en la tabla `audit_logs`. En la página de
la base en Render, **Connect → PSQL Command** te da el comando para entrar con `psql` desde tu
compu; adentro:

```sql
SELECT a.created_at, u.email, a.action, a.entity_type, a.entity_id
  FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
 ORDER BY a.created_at DESC LIMIT 20;
```

**Nunca vuelvas a sembrar una base con datos.** El catálogo inicial se carga una sola vez, con la
base vacía. Sembrar de nuevo a mano (`npm run db:seed:prod`) devuelve líneas, productos, reseñas y
combos a sus valores de fábrica y pisa lo que cambiaste desde el dashboard.

## 10. Pasar de la prueba gratis a vender

1. **Render, planes pagos.** En el repo del back, abrí `render.yaml` y cambiá las tres líneas
   marcadas con `PLAN`:

   | Línea                          | Gratis | Para vender  |
   | ------------------------------ | ------ | ------------ |
   | `plan` de `galpon-mates-api`   | `free` | `0.5c-512mb` |
   | `plan` de `galpon-mates-redis` | `free` | `256mb`      |
   | `plan` de `galpon-mates-db`    | `free` | `0.1c-256mb` |

   Subí el cambio a GitHub: Render lo aplica solo. Los precios de hoy están en
   [render.com/pricing](https://render.com/pricing); cuando se escribió esta guía eran del orden de
   7, 10 y 6 dólares por mes, pero confirmalo ahí.

2. **Mails.** Con el back en el plan pago, cambiá `SMTP_PORT` a `587` en Render (**Environment**).
3. **Vercel Pro.** En Vercel: **Settings → Billing → Upgrade**. Es el plan que permite uso
   comercial (del orden de 20 dólares por mes; confirmalo en
   [vercel.com/pricing](https://vercel.com/pricing)).
4. **Mercado Pago de producción.** Cambiá en Render `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` y en
   Vercel (tienda) `NEXT_PUBLIC_MP_PUBLIC_KEY` por los de producción, configurá el webhook en "Modo
   productivo" (paso 2) y volvé a desplegar la tienda.
5. **Dominio propio** (recomendado antes de abrir al público; para los mails es necesario). **Con
   la mudanza a Render, en vez de esto seguí la sección 13**; lo que sigue es para quedarse en
   Vercel.
   - En Vercel, proyecto `galpon-mates` → **Settings → Domains**: agregá `tudominio.com.ar` y
     `www.tudominio.com.ar`. En `galpon-mates-admin`: agregá `admin.tudominio.com.ar`. Vercel te
     dice qué registros cargar en el DNS del dominio.
   - Cambiá las direcciones como dice la sección 6 (tienda y dashboard) y volvé a desplegar.
   - El back puede quedarse en `onrender.com`: nadie ve esa dirección.
   - En el servicio de mails, verificá el dominio y cargá en el DNS los registros **SPF** y
     **DKIM** que te indique. Sin eso los mails caen en spam.
6. Repetí la lista de la sección 7.

## 11. Problemas frecuentes

| Qué pasa                                               | Qué mirar                                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El back no arranca en Render                           | **Logs**: si es una variable, el mensaje la nombra. Corregila en **Environment**.                                                                                                   |
| El build de la tienda falla en Vercel                  | El back estaba dormido o `API_BASE_URL` está mal. Abrí la dirección de salud, esperá el `ok` y **Redeploy**.                                                                        |
| La tienda tarda un minuto en abrir                     | Plan gratis de Render: el back estaba dormido. En el plan pago no pasa.                                                                                                             |
| El dashboard no deja entrar o se sale solo             | `VITE_API_BASE_URL` tiene que ser la dirección del dashboard (no la de Render), y la línea `"dest"` de `apps/admin/vercel.json`, la dirección real del back.                        |
| La tienda no muestra un cambio del dashboard           | Tarda hasta un minuto. Si no aparece: `REVALIDATE_SECRET` (Vercel) tiene que ser igual a `STORE_REVALIDATE_SECRET` (Render), y `STORE_ORIGIN`, la dirección real de la tienda.      |
| No llegan los mails                                    | En el plan gratis, el puerto tiene que ser 2525. Revisá `SMTP_*` y `MAIL_FROM` en Render y buscá `mail` en los logs. Los mails se reintentan solos 5 veces.                         |
| El pedido no pasa a "Pagado"                           | En Mercado Pago → Webhooks, mirá si la notificación dio error. Un 401 es `MP_WEBHOOK_SECRET` mal copiada. El back además consulta por su cuenta los pagos pendientes a los minutos. |
| No se pueden subir fotos                               | Revisá las tres `CLOUDINARY_*` en Render y `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` en Vercel.                                                                                           |
| "Demasiados intentos" para todos los clientes a la vez | El back no está recibiendo la IP real: `API_PROXY_SECRET` (Vercel, los dos proyectos) igual a `TRUSTED_PROXY_SECRET` (Render), y `TRUSTED_CLIENT_IP_HEADER=x-real-ip` en la tienda. |
| Render avisa que la base gratis vence                  | Pasá la base al plan pago (sección 10) antes de la fecha: no se pierde nada.                                                                                                        |

## 12. En tu compu (desarrollo)

Esto es para trabajar en el código, no para publicar. Hace falta Node 22, npm y Docker Desktop
abierto. Los dos repos van uno al lado del otro (`frontend` y `backend`).

**Back** (en la carpeta `backend`):

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

- `npm install` baja las dependencias (y genera el cliente de la base).
- `npm run db:up` levanta Postgres y Redis en Docker.
- `npm run db:migrate` crea o actualiza las tablas. **Hay que correrlo cada vez que bajes cambios
  que traen migraciones nuevas** (hoy falta correrlo: B8 sumó la tabla `audit_logs`).
- `npm run db:seed` carga el catálogo de ejemplo y el admin de demostración.
- `npm run dev` levanta el back en `http://localhost:3001`.

**Front** (en la carpeta `frontend`):

```bash
npm install
```

```bash
npm run dev
```

Levanta la tienda en `http://localhost:3000` y el dashboard en `http://localhost:5173`, los dos con
datos de prueba y sin necesidad del back. Para que usen el back de tu compu, mirá "Backend local" en
los `.env.example` de `apps/store` y `apps/admin`.

## 13. Todo en Render con el dominio propio

Esta sección muda la tienda y el dashboard de Vercel a **Render**, al lado del back, y pone las tres
piezas en el dominio **galponmates.com.ar**. Al terminar, Vercel ya no hace falta (ni su plan Pro).
Se sigue de arriba hacia abajo una sola vez; mientras tanto, la versión de Vercel sigue andando.

### Cómo queda

| Pieza     | Dirección                                            | En Render                                            |
| --------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Tienda    | `https://galponmates.com.ar` (el `www` te lleva ahí) | Servicio `galpon-mates-tienda` (gratis para probar)  |
| Dashboard | `https://admin.galponmates.com.ar`                   | Sitio estático `galpon-mates-admin` (siempre gratis) |
| Back      | `https://api.galponmates.com.ar`                     | Servicio `galpon-mates-api` (el de siempre)          |

- La tienda y el dashboard salen del archivo `render.yaml` del **repo del front**: es un Blueprint
  aparte del del back. El back, la base y el Redis no se tocan; solo cambian unos valores.
- El dashboard ahora le habla **directo** al back. Como los dos están en `galponmates.com.ar`, la
  sesión funciona sin el reenvío que hacía Vercel.
- La dirección vieja del back (`https://galpon-mates-api.onrender.com`) sigue andando: la tienda la
  usa por dentro. No hay que borrarla.

### 13.1 Lo que tiene que estar listo antes

- [ ] **El dominio en Cloudflare.** El dueño compró `galponmates.com.ar` en NIC Argentina. Hay que
      "delegarlo" a Cloudflare, que es donde se cargan los registros:
  1. Creá una cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a
     domain** → `galponmates.com.ar` → plan **Free**.
  2. Cloudflare muestra **dos servidores de nombres** (terminan en `ns.cloudflare.com`). Copialos.
  3. El dueño entra a [nic.ar](https://nic.ar) con su cuenta (o te suma como administrador
     alterno) → su dominio → **Delegaciones** → borra las que haya y carga las dos de Cloudflare.
  4. Esperá el mail de Cloudflare que avisa que el dominio está **Active**. Puede tardar desde
     unos minutos hasta 48 horas.
- [ ] **Los cambios subidos a GitHub**, primero el back y después el front (la rama
      `feat/render-todo` de cada repo, unida a `main`). Al subir el back, Render le suma solo el
      dominio `api.galponmates.com.ar` al servicio `galpon-mates-api` (todavía no anda: falta el
      DNS) y la variable `TRUSTED_CLIENT_IP_HEADER`.
- [ ] **Una cuenta de Brevo** ([brevo.com](https://www.brevo.com)) para los mails, en el plan
      gratis.

### 13.2 Render: crear la tienda y el dashboard

1. Abrí `https://galpon-mates-api.onrender.com/api/v1/health` y esperá el `"status":"ok"`: la
   tienda lee el catálogo del back al compilar.
2. En [dashboard.render.com](https://dashboard.render.com): **New → Blueprint**.
3. Elegí **el repo del front**. Nombre del Blueprint: `galpon-mates-front`. Rama: `main`.
4. Render muestra lo que va a crear (`galpon-mates-tienda` y `galpon-mates-admin`) y te pide dos
   valores. Cargalos sin comillas ni espacios de más:

| Variable                            | Qué poner                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MP_PUBLIC_KEY`         | La **Public Key** de Mercado Pago: la misma que tenés hoy en Vercel (de la misma aplicación y del mismo tipo, prueba o producción, que el Access Token del back). |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | El nombre de la nube de Cloudinary (el mismo `CLOUDINARY_CLOUD_NAME` del back).                                                                                   |

5. Clic en **Deploy Blueprint** (o **Apply**). La tienda tarda unos minutos en compilar; el
   dashboard, menos.

**Las demás variables ya vienen en el archivo**: no hay que cargarlas. Para que sepas de dónde sale
cada una:

| Variable de la tienda               | Valor                                   | De dónde sale                                                               |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `API_MODE` y `NEXT_PUBLIC_API_MODE` | `live`                                  | Fijo: la tienda usa el back de verdad.                                      |
| `API_BASE_URL`                      | `https://galpon-mates-api.onrender.com` | El back. La tienda le habla por dentro; ningún visitante ve esta dirección. |
| `NEXT_PUBLIC_SITE_URL`              | `https://galponmates.com.ar`            | La dirección de la tienda.                                                  |
| `TRUSTED_CLIENT_IP_HEADER`          | `true-client-ip`                        | Dónde deja Render la IP de cada visitante (para los límites de intentos).   |
| `REVALIDATE_SECRET`                 | La copia Render sola                    | Es el `STORE_REVALIDATE_SECRET` del back.                                   |
| `API_PROXY_SECRET`                  | La copia Render sola                    | Es el `TRUSTED_PROXY_SECRET` del back.                                      |

| Variable del dashboard | Valor                            | De dónde sale                             |
| ---------------------- | -------------------------------- | ----------------------------------------- |
| `VITE_API_MODE`        | `live`                           | Fijo.                                     |
| `VITE_API_BASE_URL`    | `https://api.galponmates.com.ar` | El back, en su dirección nueva.           |
| `VITE_STORE_URL`       | `https://galponmates.com.ar`     | La tienda, para los enlaces "Ver tienda". |

**Si Render da un error con `REVALIDATE_SECRET` o `API_PROXY_SECRET`** al crear el Blueprint (por
ejemplo, porque el servicio del back no se llama `galpon-mates-api`), cargalos a mano: copiá
`STORE_REVALIDATE_SECRET` y `TRUSTED_PROXY_SECRET` de `galpon-mates-api` → **Environment** y
pegalos en `galpon-mates-tienda` → **Environment** como `REVALIDATE_SECRET` y `API_PROXY_SECRET`.

6. Cuando termine, abrí la dirección que Render le dio a la tienda (está debajo del nombre del
   servicio, del estilo `https://galpon-mates-tienda.onrender.com`): tiene que mostrar la tienda.
   El dashboard en su dirección `onrender.com` abre pero **todavía no deja entrar**: necesita el
   dominio (pasos 13.3 a 13.5).
7. **Anotá las tres direcciones `onrender.com`** (tienda, dashboard y back). Si Render le agregó
   letras a algún nombre porque estaba tomado (por ejemplo
   `galpon-mates-tienda-x7k2.onrender.com`), en el paso siguiente usá la dirección real.

### 13.3 Cloudflare: los registros del dominio

En Cloudflare → `galponmates.com.ar` → **DNS → Records**.

1. **Borrá** los registros de tipo `A` o `AAAA` que haya para `galponmates.com.ar`, `www`, `admin`
   o `api` (Cloudflare a veces los copia solo al sumar el dominio). Render no usa `AAAA`.
2. Cargá estos cuatro con **Add record**. En **Proxy status** sacá la nube naranja: tiene que quedar
   gris, **DNS only**. Render lo necesita para sacar los certificados (el candado) y para ver la IP
   de cada visitante.

| Tipo    | Nombre  | Destino (Target)                   | Proxy status |
| ------- | ------- | ---------------------------------- | ------------ |
| `CNAME` | `@`     | `galpon-mates-tienda.onrender.com` | DNS only     |
| `CNAME` | `www`   | `galpon-mates-tienda.onrender.com` | DNS only     |
| `CNAME` | `admin` | `galpon-mates-admin.onrender.com`  | DNS only     |
| `CNAME` | `api`   | `galpon-mates-api.onrender.com`    | DNS only     |

- `@` es el dominio solo (`galponmates.com.ar`). Cloudflare acepta un `CNAME` ahí; con Cloudflare,
  Render pide justamente eso y no el registro `A` que menciona para otros proveedores.
- `www` va al mismo lugar que la tienda: Render lo redirige solo a `https://galponmates.com.ar`.
  No hay que armar ninguna regla de redirección en Cloudflare.
- Si en el paso 13.2 alguna dirección quedó con letras de más, el destino es esa dirección.

3. **SSL/TLS → Overview**: modo **Full**. Con todo en "DNS only" no cambia nada, pero es lo que pide
   Render.
4. No prendas la nube naranja más adelante: el back está pensado para "DNS only".

### 13.4 Render: verificar los tres dominios

1. Esperá unos minutos después de cargar los registros.
2. En Render, entrá a cada servicio → **Settings → Custom Domains**:
   - `galpon-mates-tienda`: `galponmates.com.ar` y `www.galponmates.com.ar`.
   - `galpon-mates-admin`: `admin.galponmates.com.ar`.
   - `galpon-mates-api`: `api.galponmates.com.ar`.
3. Si alguno no está verificado, clic en **Verify**. Cuando el DNS ya llegó pasa a **Verified**, y
   unos minutos después el certificado queda emitido. Si falla, esperá un rato y probá de nuevo: el
   DNS a veces tarda.
4. Probá: `https://api.galponmates.com.ar/api/v1/health` responde `"status":"ok"` y
   `https://galponmates.com.ar` muestra la tienda con el candado.

### 13.5 El back: las direcciones nuevas y Mercado Pago

En Render → `galpon-mates-api` → **Environment**, cambiá estos tres valores (sin barra al final) y
clic en **Save, rebuild, and deploy**:

| Variable            | Valor nuevo                        | Para qué                                                                        |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `STORE_ORIGIN`      | `https://galponmates.com.ar`       | Los enlaces de los mails, la vuelta del pago y el aviso de cambios a la tienda. |
| `ADMIN_ORIGIN`      | `https://admin.galponmates.com.ar` | El único sitio que puede usar el back desde el navegador: el dashboard.         |
| `PUBLIC_API_ORIGIN` | `https://api.galponmates.com.ar`   | La dirección del aviso de cada pago que el back le pasa a Mercado Pago.         |

`TRUSTED_CLIENT_IP_HEADER` (`true-client-ip`) ya la puso el archivo `render.yaml` del back: no hay
que cargarla.

**Mercado Pago.** En [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers) →
tu aplicación → **Webhooks → Configurar notificaciones**, cambiá la URL por:

```
https://api.galponmates.com.ar/api/v1/webhooks/mercadopago
```

Evento: **Pagos**. Guardá. Si al guardar Mercado Pago muestra una **clave secreta nueva**, copiala
en `MP_WEBHOOK_SECRET` del back (**Environment** → **Save, rebuild, and deploy**). Si tenés
configurados los dos modos ("Modo pruebas" y "Modo productivo"), cambiá la URL en los dos.

Desde acá la tienda de Vercel deja de enterarse de los cambios del dashboard (el back le avisa a la
de Render). No pasa nada: se apaga en el paso 13.8.

### 13.6 Mails: Brevo con el dominio

Para que los mails salgan de `hola@galponmates.com.ar` y no caigan en spam:

1. **Recibir en `hola@`.** Brevo manda un código a esa dirección para verificarla, y los clientes
   van a responder ahí. Lo más simple, y gratis: Cloudflare → `galponmates.com.ar` → **Email →
   Email Routing** → **Get started** → dirección `hola` → que reenvíe al mail del dueño (o al tuyo).
   Cloudflare carga solo sus registros (`MX` y un `TXT` de SPF): aceptalos.
2. **Autenticar el dominio.** En Brevo → **Settings → Senders, domains & dedicated IPs → Domains →
   Add a domain** → `galponmates.com.ar`. Brevo ofrece dos caminos:
   - **Automático** (el más fácil): elegí conectarte con Cloudflare, entrá con tu cuenta y Brevo
     carga solo los registros.
   - **A mano**: Brevo muestra los registros con sus valores. Cargalos en Cloudflare (**DNS →
     Records**) tal cual los muestra Brevo, siempre en **DNS only**. Tienen esta forma; el código y
     los destinos exactos salen de tu cuenta:

| Tipo    | Nombre              | Contenido (ejemplo: usá el que te muestra Brevo)           |
| ------- | ------------------- | ---------------------------------------------------------- |
| `TXT`   | `@`                 | `brevo-code:` seguido del código de tu cuenta              |
| `CNAME` | `brevo1._domainkey` | `b1.galponmates-com-ar.dkim.brevo.com` (DKIM)              |
| `CNAME` | `brevo2._domainkey` | `b2.galponmates-com-ar.dkim.brevo.com` (DKIM)              |
| `TXT`   | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` (DMARC) |

- En **Nombre** poné solo lo de la tabla: Cloudflare le agrega `.galponmates.com.ar` solo.
- **SPF**: Brevo hoy no lo exige. Si tu cuenta te lo pide, tiene que haber **un solo** registro
  `TXT` en `@` que empiece con `v=spf1`. Con el Email Routing del paso 1 ya hay uno: editalo para
  que quede `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all`, sin cargar un
  segundo.
- Tiene que haber **un solo** registro `_dmarc`.
- En Brevo, clic en **Authenticate** (o **Verify**). Puede tardar hasta 48 horas en quedar todo
  en verde.

3. **El remitente.** Brevo → **Senders → Add a sender**: nombre `Galpón Mates`, email
   `hola@galponmates.com.ar`. Verificalo con el código que llega por el reenvío del paso 1.
4. **Los datos SMTP.** Brevo → **SMTP & API → SMTP**: están el servidor, el usuario (un login del
   estilo `xxxx@smtp-brevo.com`) y el botón para generar una **SMTP key**, que es la contraseña.
5. En Render → `galpon-mates-api` → **Environment**, y después **Save, rebuild, and deploy**:

| Variable    | Valor                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `SMTP_HOST` | `smtp-relay.brevo.com`                                                |
| `SMTP_PORT` | `2525` mientras el back esté en el plan gratis; `587` en el plan pago |
| `SMTP_USER` | El login SMTP de Brevo                                                |
| `SMTP_PASS` | La SMTP key                                                           |
| `MAIL_FROM` | `Galpón Mates <hola@galponmates.com.ar>` (así, sin comillas)          |

### 13.7 Comprobar que anda

- [ ] `https://api.galponmates.com.ar/api/v1/health` responde `"status":"ok"`.
- [ ] `https://galponmates.com.ar` muestra la tienda con los productos y el candado.
- [ ] `https://www.galponmates.com.ar` te lleva a `https://galponmates.com.ar`.
- [ ] `https://admin.galponmates.com.ar` abre el dashboard y **entra** con tu email y tu
      contraseña. **Recargá la página**: tiene que seguir adentro. Andá a otra sección y recargá de
      nuevo (prueba que cualquier dirección del dashboard abre).
- [ ] En el dashboard, **Ajustes**: guardá un cambio. En menos de un minuto la tienda nueva lo
      muestra (prueba el aviso del back a la tienda).
- [ ] **Una foto**: subí una foto a un producto desde el dashboard y mirá que la tienda la muestre.
- [ ] **Un mail**: en la tienda, mandá un mensaje desde **Contacto** (o creá una cuenta). Tiene que
      llegar de `hola@galponmates.com.ar`, a la bandeja de entrada y no a spam.
- [ ] **Una compra de prueba**: con credenciales de prueba, una tarjeta de prueba de Mercado Pago
      (están en el README del back, "Sandbox de Mercado Pago"); con las de producción, un producto
      barato con tu tarjeta, y después devolvé la plata. El pedido pasa a "Pagado" en el dashboard
      y en **Mercado Pago → Webhooks** la última notificación figura entregada (código 200) a
      `api.galponmates.com.ar`.
- [ ] **Los límites cuentan por persona**: en el dashboard, probá entrar con una contraseña
      equivocada hasta que aparezca el aviso de demasiados intentos. Desde el celular con datos
      (sin wifi) tiene que seguir dejándote intentar. Lo mismo con una cuenta de la tienda. Si se
      bloquea para todos a la vez, revisá que `TRUSTED_CLIENT_IP_HEADER` sea `true-client-ip` en
      el back y en la tienda, y que los registros de Cloudflare estén en "DNS only".

### 13.8 Apagar Vercel

Cuando toda la lista de arriba dio bien y pasaron uno o dos días sin problemas:

1. Confirmá que nada apunta a Vercel: en Render (`galpon-mates-api` → **Environment**),
   `STORE_ORIGIN` y `ADMIN_ORIGIN` son las direcciones nuevas, y en Mercado Pago el webhook es el de
   `api.galponmates.com.ar`.
2. En [vercel.com](https://vercel.com), proyecto `galpon-mates` → **Settings → General** → abajo
   de todo, **Delete Project**. Lo mismo con `galpon-mates-admin`.
3. No hace falta el plan Pro de Vercel: la sección 10, paso 3, ya no corre.
4. Para el código, sin apuro: el archivo `apps/admin/vercel.json` del front y las partes de Vercel
   de esta guía se pueden borrar en una pieza aparte.

### 13.9 Gratis para probar, pago para vender

Mientras se prueba, todo queda gratis. Tené en cuenta:

- La tienda gratis, igual que el back gratis, **se duerme a los 15 minutos** sin visitas y tarda
  alrededor de un minuto en despertar.
- Render regala **750 horas por mes** de servicios gratis para toda la cuenta. La tienda y el back
  prendidos todo el mes serían unas 1.440: si se agotan, Render frena los servicios gratis hasta
  fin de mes. Como se duermen solos cuando no hay visitas, durante la prueba no debería pasar; si
  pasa, es la señal de pasar a pago.
- El resto de los límites del plan gratis (la base que se borra a los 30 días, el Redis sin disco,
  el puerto 2525 para los mails) está en "Gratis para probar, pago para vender", al principio de
  esta guía.

**Al abrir al público**, pasá a pago lo que atiende gente. Sigue siendo la cuenta **Hobby** de
Render, sin el plan Pro de 25 USD: se pagan solo las instancias.

| Qué               | Dónde se cambia                                                    | Gratis | Pago         | Precio aprox. por mes                  |
| ----------------- | ------------------------------------------------------------------ | ------ | ------------ | -------------------------------------- |
| Tienda            | `render.yaml` del **front**, línea `PLAN` de `galpon-mates-tienda` | `free` | `0.5c-512mb` | 7 USD                                  |
| Back              | `render.yaml` del **back**, línea `PLAN` de `galpon-mates-api`     | `free` | `0.5c-512mb` | 7 USD                                  |
| Base (Postgres)   | `render.yaml` del **back**, línea `PLAN` de `galpon-mates-db`      | `free` | `0.1c-256mb` | 6 USD                                  |
| Redis (Key Value) | `render.yaml` del **back**, línea `PLAN` de `galpon-mates-redis`   | `free` | `256mb`      | 10 USD                                 |
| Dashboard         | Nada: es un sitio estático                                         | gratis | gratis       | 0                                      |
| Dominios propios  | Nada: Render los cobra solo                                        | —      | —            | 0,25 USD cada uno a partir del tercero |
| **Total**         |                                                                    |        |              | **unos 30 USD**                        |

- Se cambia la palabra, se sube el cambio a GitHub y Render lo aplica solo.
- Los nombres de plan son los de la
  [referencia de Blueprints](https://render.com/docs/blueprint-spec) (`0.5c-512mb`, `256mb`,
  `0.1c-256mb`). Render sigue aceptando los viejos (`starter`, `basic-256mb`). Confirmá los
  precios en [render.com/pricing](https://render.com/pricing).
- **El disco de la base se cobra aparte** (0,30 USD por GB al mes) y no se puede achicar. Sin la
  línea `diskSizeGB`, Render pone 15 GB: en `render.yaml` está fijo en 1.
- Para pasar todo a **otra cuenta de Render**, ver [MUDANZA-RENDER.md](MUDANZA-RENDER.md).
- Dominios: la cuenta Hobby trae 2 y cada uno más cuesta 0,25 USD por mes. Acá son tres
  (`galponmates.com.ar`, `admin` y `api`); Render no aclara si el `www` que agrega solo cuenta
  aparte, así que son entre 0,25 y 0,50 USD por mes.
- El ancho de banda que incluye la cuenta Hobby, y lo que cuesta pasarse, están en la misma página
  de precios.
- Con el back en el plan pago, cambiá `SMTP_PORT` a `587` (paso 13.6).
- Para vender hacen falta además las credenciales de **producción** de Mercado Pago: en Render,
  `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` del back y `NEXT_PUBLIC_MP_PUBLIC_KEY` de la tienda, y el
  webhook en "Modo productivo" (paso 13.5). Después de cambiar la clave de la tienda, en
  `galpon-mates-tienda` → **Manual Deploy → Deploy latest commit**: queda fija al compilar.

### 13.10 Si algo falla

| Qué pasa                                                     | Qué mirar                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| El build de la tienda falla en Render                        | El back estaba dormido: abrí su dirección de salud, esperá el `ok` y en la tienda **Manual Deploy → Deploy latest commit**.                         |
| Un dominio no se verifica en Render                          | El registro en Cloudflare: nombre, destino y "DNS only" (nube gris). Borrá cualquier `AAAA`. Esperá un rato y **Verify** de nuevo.                  |
| El dashboard abre pero no deja entrar, o se sale al recargar | `ADMIN_ORIGIN` del back tiene que ser exactamente `https://admin.galponmates.com.ar`, y `api.galponmates.com.ar` tiene que estar verificado.        |
| La tienda no muestra un cambio del dashboard                 | `STORE_ORIGIN` del back tiene que ser `https://galponmates.com.ar`. Tarda hasta un minuto.                                                          |
| Los mails no llegan o van a spam                             | Brevo → Domains, todo en verde. `MAIL_FROM` con `hola@galponmates.com.ar` y `SMTP_PORT` 2525 en el plan gratis. En el back, **Logs**: buscá `mail`. |
| El pedido no pasa a "Pagado"                                 | La URL del webhook en Mercado Pago y `PUBLIC_API_ORIGIN` del back. Un 401 en Mercado Pago es `MP_WEBHOOK_SECRET` mal copiada.                       |

## Lo que se probó y lo que no

**Probado en una compu, el 2026-11-17:**

- **La imagen del back, la misma que usa Render**, con las variables de `render.yaml` y
  credenciales falsas: se construye, corre sin permisos de administrador, aplica las 15 migraciones
  al arrancar, carga el catálogo y crea el admin solo la primera vez (al reiniciar dice "Seed
  salteado") y responde la ruta de salud. Con el tope de 512 MB de memoria del plan pago más chico
  usó unos 160 MB.
- **La tienda compilada en vivo contra ese back**, con el secreto compartido: los límites cuentan
  por cliente (uno bloqueado por exceso de intentos no bloquea a otro) y no se saltean inventando
  cabeceras; quien le pega directo al back comparte un solo cupo y no afecta a los visitantes; el
  secreto no aparece en los logs.
- **El ingreso al dashboard tal como le llegaría al back desde Vercel**: entra y limita por
  visitante.
- El `render.yaml` es válido contra el esquema oficial de Render, y los planes (`free`,
  `0.5c-512mb`, `0.1c-256mb`) existen.
- Las suites de pruebas completas del back y del front, con Next 16.4.5.
- El camino alternativo (el compose con Docker) también se levantó entero en esa compu.

**La mudanza a Render (sección 13), probado en una compu el 2026-11-19:**

- Los dos `render.yaml` (el del back con el dominio `api.` y `TRUSTED_CLIENT_IP_HEADER`, y el nuevo
  del front con la tienda y el dashboard) son válidos contra el esquema oficial de Render.
- La tienda compilada arranca con `next start` en el puerto que le da Render (`PORT`).
- El back cuenta los límites por la IP de `True-Client-IP` cuando el pedido llega sin el secreto
  (el dashboard llamando directo), y lo que manda la tienda con el secreto sigue ganando. Lo
  cubren las pruebas automáticas.
- Las cabeceras del dashboard en `render.yaml` coinciden con las del código (una prueba automática
  lo controla).

**De la mudanza, no se pudo probar sin tus cuentas** (el paso 13.7 es la primera vez):

- Que Render compile la tienda y el dashboard desde el monorepo con esos comandos, y que copie los
  dos secretos del back (`fromService`) desde otro Blueprint, como dice su documentación.
- Que Cloudflare escriba la IP real de cada visitante en `True-Client-IP` y que nadie la pueda
  inventar. **Render no lo documenta**: lo dice su soporte, citado en un artículo de un usuario
  ([rohitpaulk.com](https://rohitpaulk.com/articles/render-rails-remote-ip)). El último punto del
  paso 13.7 lo comprueba.
- La sesión del dashboard llamando directo al back en `api.galponmates.com.ar` (es lo mismo que el
  camino del servidor propio, que sí se probó, pero no en Render).
- Los dominios, los certificados, Brevo y Mercado Pago con el dominio.

**No se pudo probar sin tus cuentas de Vercel y de Render** (el paso 7 es la primera vez que se
prueba de verdad):

- Que el Blueprint se cree sin errores en tu cuenta y que la dirección quede como la de la guía.
- Que Vercel compile los dos proyectos desde el monorepo con `apps/store` y `apps/admin` como
  carpeta raíz.
- El reenvío del dashboard al back (`apps/admin/vercel.json`): está escrito siguiendo la
  documentación de Vercel, pero solo se puede probar desplegado. Si el dashboard no entra, es lo
  primero que hay que mirar.
- Que la IP real de cada visitante llegue al back a través de Vercel (el último punto del paso 7).
- Mercado Pago, los mails y Cloudinary con credenciales reales.
- Cuánto tarda en despertar el back gratis y si la tienda aguanta esa espera al compilar.
