# Mudar Galpón Mates a otra cuenta de Render

Guía para pasar los cinco recursos de Render (back, tienda, dashboard, base y Redis) de una cuenta
a otra. Se escribió el 2026-11-26 para mudarlos de la cuenta personal de Lucas ("My Workspace") a
la cuenta del negocio ("galpon's workspace"), que es la que paga.

Render **no permite transferir** servicios ni bases entre cuentas (lo dice su
[FAQ](https://render.com/docs/faq)): hay que **crearlos de nuevo** en la cuenta de destino y
llevar los datos a mano. Eso es lo que hace esta guía.

Marcá cada casilla a medida que avanzás. Si un paso no da el resultado que dice "Tiene que
quedar", **frená ahí**: hasta la etapa 5 no se cambió nada y la página sigue andando como antes.

## Qué se muda y qué no

| Cosa                                   | ¿Se muda?                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------- |
| El código                              | No hace falta: sale de GitHub, igual que antes                             |
| La base (productos, pedidos, ajustes)  | Sí, con una copia (etapas 1 y 8)                                           |
| Las fotos                              | No: viven en Cloudinary. La base guarda sus direcciones                    |
| El Redis (colas, sesiones)             | No: arranca vacío. Hay que volver a entrar al dashboard                    |
| Las variables con claves               | Se vuelven a cargar a mano (etapas 6 y 9)                                  |
| Los dominios                           | Se sacan de los servicios viejos y se agregan a los nuevos (etapas 5 a 10) |
| Mercado Pago, Brevo, Cloudflare (mail) | No cambian: apuntan al dominio, no a Render                                |

## Cuánto cuesta por mes en la cuenta nueva

Precios de [render.com/pricing](https://render.com/pricing) al 2026-11-26. La cuenta es **Hobby**
(0 USD fijos): se paga solo lo que se usa, prorrateado por segundo.

| Recurso                          | Plan en `render.yaml`          | USD por mes    |
| -------------------------------- | ------------------------------ | -------------- |
| Back (`galpon-mates-api`)        | `0.5c-512mb`                   | 7              |
| Tienda (`galpon-mates-tienda`)   | `0.5c-512mb`                   | 7              |
| Base (`galpon-mates-db`)         | `0.1c-256mb`                   | 6              |
| Disco de la base                 | `diskSizeGB: 1`                | 0,30           |
| Redis (`galpon-mates-redis`)     | `free`                         | 0              |
| Dashboard (`galpon-mates-admin`) | sitio estático                 | 0              |
| Dominios propios                 | 2 incluidos, 0,25 cada uno más | 0,25 a 0,50    |
| **Total**                        |                                | **unos 20,80** |

- A eso se suman los impuestos que aplique la tarjeta.
- La cuenta Hobby incluye 5 GB de tráfico y 500 minutos de compilación por mes. Pasarse cuesta
  0,15 USD por GB y 5 USD cada 1.000 minutos. Las fotos las sirve Cloudinary, no Render.
- **El disco de la base no se puede achicar.** Sin la línea `diskSizeGB`, Render pone 15 GB
  (4,50 USD por mes): por eso está escrita en `render.yaml`.
- Un recurso sin línea `plan` **no** sale gratis: Render le pone el plan pago por omisión.

## Lo que hay que tener a mano

- [ ] Docker Desktop abierto ("Engine running").
- [ ] Las dos cuentas de Render abiertas, cada una en su pestaña.
- [ ] Cloudflare, en los registros DNS de `galponmates.com.ar`.
- [ ] Las claves de **producción** de Mercado Pago (Public Key, Access Token y la clave secreta
      del webhook), **renovadas** si alguna vez se pegaron en un chat o en una captura.
- [ ] Que nadie cargue ni edite nada en el dashboard desde la etapa 1 hasta el final: lo que se
      cargue en el medio se pierde.

Las claves no se mandan por chat ni se muestran en capturas: se copian de una pestaña a la otra.

## Etapa 1. Copiar la base de la cuenta vieja

No cambia nada en Render: solo lee.

- [ ] Cuenta **vieja** → `galpon-mates-db` → **Connect** → pestaña **External** → copiar la
      **External Database URL**.
- [ ] En PowerShell:

  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Users\lucas\Desktop\E-comers Marcos\backend\scripts\mudanza\copiar-base.ps1"
  ```

- [ ] Pegar la dirección cuando la pide (no se ve en pantalla, es a propósito) y Enter.

**Tiene que quedar:** en verde, `COPIA COMPLETA Y COMPROBADA: 30 tablas, todas con la misma
cantidad de filas que la original`, y en `C:\galpon-copia` un archivo `galpon-FECHA.dump` con su
`galpon-FECHA.conteo.txt`.

El script hace la copia, la carga en una base de prueba dentro de Docker y compara tabla por tabla
contra la original. Si avisa que alguna tabla cambió mientras copiaba, hay que mirar cuál antes de
seguir.

## Etapa 2. Congelar la cuenta vieja

Sin esto, al subir el código Render pasaría a planes pagos los servicios **viejos**, y al borrar
un servicio viejo lo volvería a crear.

- [ ] Cuenta **vieja** → **Blueprints** → entrar al del back → **Settings** → **Auto Sync: No**.
- [ ] Lo mismo en el Blueprint del front.

**Tiene que quedar:** los dos Blueprints con Auto Sync en "No".

## Etapa 3. Subir el código

- [ ] El back primero:

  ```powershell
  git -C "C:\Users\lucas\Desktop\E-comers Marcos\backend" push origin main
  ```

- [ ] Después el front:

  ```powershell
  git -C "C:\Users\lucas\Desktop\E-comers Marcos\frontend" push origin main
  ```

Los servicios viejos se van a volver a desplegar con el mismo código: es inofensivo.

**Tiene que quedar:** en GitHub, los dos repos con el último commit de hoy.

## Etapa 4. Preparar la cuenta nueva

- [ ] Cuenta **nueva** → **Billing** → cargar la tarjeta.
- [ ] Cuenta **nueva** → ícono de la cuenta → **Account Settings** → **Account Security** →
      **Git Deployment Credentials** → **Add credential** → GitHub → autorizar con el GitHub de
      Lucas (los repos son de él) y dar acceso a los dos repos de Galpón.
- [ ] **No crear ningún servicio a mano** (ni Key Value, ni Postgres, ni Web Service): los crea el
      Blueprint.

**Tiene que quedar:** en **New → Blueprint**, la lista muestra los dos repos de Galpón.

Según la [doc de Render](https://render.com/docs/login-settings), una misma cuenta de GitHub puede
servir de credencial de despliegue en varias cuentas de Render. Si igual la rechaza, la salida es
desconectarla de la cuenta vieja (Account Settings → Account Security) y volver a probar.

## Etapa 5. Sacar los dominios de los servicios viejos (acá empieza el corte)

Un dominio no puede estar en dos servicios de Render a la vez, y Render tampoco deja agregar un
subdominio mientras el dominio base siga en otra cuenta.

En la cuenta **vieja**, en cada servicio → **Settings** → **Custom Domains** → borrar el dominio:

- [ ] `galpon-mates-api`: borrar `api.galponmates.com.ar`.
- [ ] `galpon-mates-tienda`: borrar `galponmates.com.ar` (se va también el `www`).
- [ ] `galpon-mates-admin`: borrar `admin.galponmates.com.ar`.

**No borrar los servicios todavía**, solo los dominios.

**Tiene que quedar:** los tres servicios viejos sin ningún dominio propio en Custom Domains.

## Etapa 6. Crear el back en la cuenta nueva

- [ ] Cuenta **nueva** → **New** → **Blueprint** → elegir el repo del **back**.
- [ ] Nombre del Blueprint: `galpon-mates`.
- [ ] En la pantalla de revisión, antes de aceptar, mirar que diga:
  - `galpon-mates-api`: plan de 0,5 CPU y 512 MB (7 USD).
  - `galpon-mates-db`: plan de 256 MB (6 USD) con **1 GB** de disco.
  - `galpon-mates-redis`: **Free**.
- [ ] Completar las variables que pide. Las de clave se copian de la cuenta vieja
      (`galpon-mates-api` → **Environment**), salvo las de Mercado Pago:

  | Variable                | Valor                                                        |
  | ----------------------- | ------------------------------------------------------------ |
  | `STORE_ORIGIN`          | `https://galponmates.com.ar`                                 |
  | `ADMIN_ORIGIN`          | `https://admin.galponmates.com.ar`                           |
  | `PUBLIC_API_ORIGIN`     | `https://api.galponmates.com.ar`                             |
  | `MP_ACCESS_TOKEN`       | El Access Token de **producción**, del panel de Mercado Pago |
  | `MP_WEBHOOK_SECRET`     | La clave secreta del webhook, del panel de Mercado Pago      |
  | `CLOUDINARY_CLOUD_NAME` | Igual que en la cuenta vieja                                 |
  | `CLOUDINARY_API_KEY`    | Igual que en la cuenta vieja                                 |
  | `CLOUDINARY_API_SECRET` | Igual que en la cuenta vieja                                 |
  | `SMTP_HOST`             | `smtp-relay.brevo.com`                                       |
  | `SMTP_PORT`             | `587` (en plan pago ya no hace falta el 2525)                |
  | `SMTP_USER`             | Igual que en la cuenta vieja                                 |
  | `SMTP_PASS`             | Igual que en la cuenta vieja                                 |
  | `MAIL_FROM`             | `Galpón Mates <hola@galponmates.com.ar>`                     |
  | `ADMIN_EMAIL`           | Igual que en la cuenta vieja                                 |
  | `ADMIN_PASSWORD`        | Igual que en la cuenta vieja                                 |

- [ ] **Deploy Blueprint** y esperar a que `galpon-mates-api` diga **Live** (unos minutos).

**Tiene que quedar:** los tres recursos en verde (Live / Available). El back arranca con el
catálogo de ejemplo: es normal, la etapa 8 lo reemplaza por los datos reales.

Render pide estas variables **solo esta vez**. Si alguna quedó mal, se corrige después en
`galpon-mates-api` → **Environment**.

Si Render rechaza el Blueprint por el dominio `api.galponmates.com.ar`, es que todavía está en la
cuenta vieja: revisar la etapa 5.

## Etapa 7. Pasar el dominio `api` al back nuevo

- [ ] Cuenta **nueva** → `galpon-mates-api` → **Settings** → **Custom Domains**: ahí está
      `api.galponmates.com.ar` y la dirección `onrender.com` a la que tiene que apuntar (no es la
      de antes: mientras exista el servicio viejo, la nueva lleva un sufijo).
- [ ] Cloudflare → registro `CNAME` `api` → cambiar el destino por esa dirección. **DNS only**
      (nube gris).
- [ ] En Render, **Verify** al lado del dominio. Si falla, esperar unos minutos y repetir.

**Tiene que quedar:** el dominio en **Verified** con **Certificate Issued**, y
`https://api.galponmates.com.ar/api/v1/health` respondiendo `"status":"ok"`.

## Etapa 8. Cargar la copia en la base nueva

Reemplaza todo el contenido de la base nueva por el de la copia. Va en una sola transacción: si
falla, la base nueva queda como estaba.

- [ ] Cuenta **nueva** → `galpon-mates-db` → **Connect** → pestaña **External** → copiar la
      **External Database URL**.
- [ ] En PowerShell:

  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Users\lucas\Desktop\E-comers Marcos\backend\scripts\mudanza\restaurar-base.ps1"
  ```

- [ ] Pegar la dirección (no se ve) y Enter. Muestra de dónde salió la copia y a qué servidor va.
- [ ] Escribir `REEMPLAZAR` y Enter.
- [ ] Cuenta **nueva** → `galpon-mates-api` → **Manual Deploy** → **Restart service**.

**Tiene que quedar:** en verde, `BASE CARGADA Y COMPROBADA: 30 tablas, todas con la misma cantidad
de filas que la copia`. El script se niega a seguir si se le pega la dirección de la base vieja.

Después de esto, el usuario y la contraseña del dashboard son **los de siempre** (vienen en la
copia), no importa lo que se haya escrito en `ADMIN_PASSWORD`.

## Etapa 9. Crear la tienda y el dashboard en la cuenta nueva

La tienda lee el catálogo de `https://api.galponmates.com.ar` al compilar: por eso las etapas 7 y
8 van antes.

- [ ] Cuenta **nueva** → **New** → **Blueprint** → elegir el repo del **front**.
- [ ] Nombre del Blueprint: `galpon-mates-front`.
- [ ] En la revisión: `galpon-mates-tienda` con plan de 0,5 CPU y 512 MB (7 USD) y
      `galpon-mates-admin` como sitio estático.
- [ ] Completar:

  | Variable                            | Valor                                               |
  | ----------------------------------- | --------------------------------------------------- |
  | `NEXT_PUBLIC_MP_PUBLIC_KEY`         | La Public Key de **producción** de Mercado Pago     |
  | `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | El mismo valor que `CLOUDINARY_CLOUD_NAME` del back |

- [ ] **Deploy Blueprint** y esperar a que los dos digan **Live** (la tienda tarda varios minutos).

**Tiene que quedar:** los dos servicios en verde.

## Etapa 10. Pasar los dominios de la tienda y del dashboard

- [ ] Cuenta **nueva** → `galpon-mates-tienda` → **Settings** → **Custom Domains**: anotar su
      dirección `onrender.com`.
- [ ] Cloudflare → `CNAME` `@` y `CNAME` `www` → los dos hacia esa dirección. **DNS only**.
- [ ] Cuenta **nueva** → `galpon-mates-admin` → **Settings** → **Custom Domains**: anotar su
      dirección `onrender.com`.
- [ ] Cloudflare → `CNAME` `admin` → hacia esa dirección. **DNS only**.
- [ ] En Render, **Verify** en cada dominio.

**Tiene que quedar:** `galponmates.com.ar`, `www.galponmates.com.ar` y `admin.galponmates.com.ar`
en **Verified** con **Certificate Issued**. Acá termina el corte.

## Etapa 11. Comprobar

- [ ] `https://api.galponmates.com.ar/api/v1/health` responde `"status":"ok"`.
- [ ] `https://galponmates.com.ar` abre y muestra los productos **reales** (los que cargó el
      negocio, con sus fotos), no los de ejemplo.
- [ ] `https://www.galponmates.com.ar` lleva a `https://galponmates.com.ar`.
- [ ] `https://admin.galponmates.com.ar` deja entrar con el usuario de siempre.
- [ ] En el dashboard, subir una foto a un producto y verla en la tienda.
- [ ] Mandar un mensaje desde el formulario de contacto de la tienda y ver que llega el mail.
- [ ] Mercado Pago → la aplicación → **Webhooks**: la dirección sigue siendo
      `https://api.galponmates.com.ar/api/v1/webhooks/mercadopago` y la clave secreta es la misma
      que se cargó en `MP_WEBHOOK_SECRET`.
- [ ] Una compra real de prueba (con tarjeta en el sitio y por Mercado Pago), ver el pedido en
      **Pagado**, el mail y el stock, y devolverla.
- [ ] Desde la carpeta del front, cuando esté publicado el arreglo de las fotos:
      `npm run smoke:produccion`.

## Etapa 12. Borrar la cuenta vieja (unos días después)

Recién cuando la etapa 11 esté completa y hayan pasado unos días sin problemas.

- [ ] Cuenta **vieja**: confirmar que los dos Blueprints siguen con Auto Sync en "No".
- [ ] Borrar `galpon-mates-tienda`, `galpon-mates-admin`, `galpon-mates-api` y
      `galpon-mates-redis`.
- [ ] Borrar `galpon-mates-db` **al final**. Es gratis y vence sola alrededor del 2026-12-18.
- [ ] Borrar la carpeta `C:\galpon-copia`: tiene datos de clientes.

## Si algo sale mal

- **Antes de la etapa 5:** no se cambió nada. Se puede frenar y retomar otro día.
- **Después de la etapa 5:** para volver atrás, en la cuenta **vieja** se vuelven a agregar los
  dominios en cada servicio (Settings → Custom Domains) y en Cloudflare se vuelven a apuntar los
  `CNAME` a las direcciones de antes: `galpon-mates-api.onrender.com`,
  `galpon-mates-tienda.onrender.com` y `galpon-mates-admin.onrender.com`. La base vieja no se tocó
  en ningún momento.
- **`pg_restore fallo`** en la etapa 8: la base nueva quedó como estaba. Mandar el mensaje de
  error (no trae la clave).
- **La tienda no compila** en la etapa 9: casi siempre es que `https://api.galponmates.com.ar`
  todavía no responde. Revisar la etapa 7 y usar **Manual Deploy** en `galpon-mates-tienda`.
- **El dashboard no deja entrar:** revisar que `ADMIN_ORIGIN` del back sea exactamente
  `https://admin.galponmates.com.ar`, sin barra al final.

## Qué se ensayó y qué no

**Ensayado el 2026-11-26, en la compu de Lucas:**

- Los dos scripts, de punta a punta, con dos Postgres 17 en Docker, el esquema real del back (las
  15 migraciones y el catálogo inicial) y un usuario **sin** permisos de administrador, como el de
  Render: la copia, su comprobación y la carga sobre una base que ya tenía datos.
- Que el back arranca sobre la base cargada sin migraciones pendientes.
- Que `restaurar-base.ps1` se niega con la dirección de la base de origen, con una Internal
  Database URL y con una clave equivocada, sin tocar nada.
- Que copiar solo el esquema `public` (lo que sugiere la guía general de Render) **no sirve** acá:
  la extensión `citext` vive en ese esquema y la carga falla. Por eso la copia va completa.

**Confirmado en la documentación oficial de Render (2026-11-26):**

- Los identificadores de plan y que `diskSizeGB` vale 1 o un múltiplo de 5 y no se puede achicar
  ([blueprint-spec](https://render.com/docs/blueprint-spec)); el archivo valida contra el
  [esquema oficial](https://render.com/schema/render.yaml.json).
- Auto Sync en "No" frena los cambios de `render.yaml`
  ([infrastructure-as-code](https://render.com/docs/infrastructure-as-code)).
- Las variables `sync: false` se piden solo al crear el Blueprint, y `fromService` puede apuntar a
  un servicio de otro Blueprint de la misma cuenta.
- Los registros de Cloudflare: `CNAME` en "DNS only", sin registros `AAAA`
  ([configure-cloudflare-dns](https://render.com/docs/configure-cloudflare-dns)).
- El plan pago de 0,5 CPU deja salir mails por el puerto 587.

**No confirmado (sale del foro de Render, no de la doc):**

- Qué hace Render si un Blueprint nuevo declara un dominio que sigue en otra cuenta. Por eso los
  dominios se sacan antes (etapa 5).
- Cómo cuenta el `www` para el cupo de 2 dominios incluidos.
- Cuánto tarda la verificación de un dominio: la doc solo dice "unos minutos".
