# Guía de despliegue de Galpón Mates: Vercel y Render

Paso a paso para publicar la tienda y el dashboard en **Vercel** y el back en **Render**. Está
pensada para seguirla de arriba hacia abajo una sola vez. No hace falta saber de servidores: son
pantallas y variables.

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

   | Línea                          | Gratis | Para vender   |
   | ------------------------------ | ------ | ------------- |
   | `plan` de `galpon-mates-api`   | `free` | `starter`     |
   | `plan` de `galpon-mates-redis` | `free` | `starter`     |
   | `plan` de `galpon-mates-db`    | `free` | `basic-256mb` |

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
5. **Dominio propio** (recomendado antes de abrir al público; para los mails es necesario).
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
- El `render.yaml` es válido contra el esquema oficial de Render, y los planes (`free`, `starter`,
  `basic-256mb`) existen.
- Las suites de pruebas completas del back y del front, con Next 16.4.5.
- El camino alternativo (el compose con Docker) también se levantó entero en esa compu.

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
