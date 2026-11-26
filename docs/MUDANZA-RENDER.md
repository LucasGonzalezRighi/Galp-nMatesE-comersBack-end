# Mudar Galpón Mates a otra cuenta de Render

Guía para pasar los cinco recursos de Render (back, tienda, dashboard, base y Redis) de una cuenta
a otra. Se escribió el 2026-11-26 para mudarlos de la cuenta personal de Lucas ("My Workspace") a
la cuenta del negocio ("galpon's workspace"), que es la que paga.

Render **no permite transferir** servicios ni bases entre cuentas (lo dice su
[FAQ](https://render.com/docs/faq)): hay que **crearlos de nuevo** en la cuenta de destino y
llevar los datos a mano. Eso es lo que hace esta guía.

Tiene tres partes:

1. **Sin corte** (etapas 1 a 5): se puede hacer con días de anticipación. La página sigue andando.
2. **El corte** (etapas 6 a 13): alrededor de una hora, de corrido y sin parar en el medio.
3. **Después** (etapa 14): borrar la cuenta vieja.

Marcá cada casilla a medida que avanzás. Si un paso no da el resultado que dice "Tiene que
quedar", **frená ahí** y mirá "Si algo sale mal".

## Qué se muda y qué no

| Cosa                                   | ¿Se muda?                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------- |
| El código                              | No hace falta: sale de GitHub, igual que antes                             |
| La base (productos, pedidos, ajustes)  | Sí, con una copia (etapas 7 y 9)                                           |
| Las fotos                              | No: viven en Cloudinary. La base guarda sus direcciones                    |
| El Redis (colas, sesiones)             | No: arranca vacío. Todos tienen que volver a iniciar sesión                |
| Las variables con claves               | Se vuelven a cargar a mano (etapas 8 y 11)                                 |
| Los dominios                           | Se sacan de los servicios viejos y se agregan a los nuevos (etapas 6 a 12) |
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

- A eso se suman los impuestos que aplique la tarjeta. Al cargarla, Render hace un cargo de
  prueba de 1 USD y lo devuelve.
- La cuenta Hobby incluye 5 GB de tráfico y 500 minutos de compilación por mes. Pasarse cuesta
  0,15 USD por GB y 5 USD cada 1.000 minutos. Las fotos las sirve Cloudinary, no Render. Cada
  subida de código gasta minutos (el back se compila siempre).
- La cuenta Hobby tiene **un solo usuario**. Para que entre otra persona con su propio usuario
  haría falta el plan Pro (25 USD por mes).
- **El disco de la base no se puede achicar.** Sin la línea `diskSizeGB`, Render pone 15 GB
  (4,50 USD por mes): por eso está escrita en `render.yaml`.
- Un recurso sin línea `plan` **no** sale gratis: Render le pone el plan pago por omisión.

## Lo que hay que tener a mano

- [ ] Docker Desktop abierto ("Engine running").
- [ ] La cuenta **vieja** de Render en el navegador de siempre y la **nueva** en **otro navegador**
      (o en una ventana privada). Dos pestañas del mismo navegador se pisan la sesión.
- [ ] Cloudflare, en los registros DNS de `galponmates.com.ar`.
- [ ] El panel de Mercado Pago abierto en las credenciales de **producción** (Public Key, Access
      Token y la clave secreta del webhook). Si hay que renovarlas porque se pegaron en un chat o
      en una captura, **no antes del corte**: renovarlas deja sin cobrar al back que esté andando.
      Se renuevan en la etapa 6.

Las claves no se mandan por chat ni se muestran en capturas: se copian de una ventana a la otra.

### Antes de cada paso que borra o suspende algo

Los cinco recursos **se llaman igual en las dos cuentas**. Antes de sacar un dominio, suspender o
borrar, comprobá las tres cosas:

1. Arriba a la izquierda dice **My Workspace** (la cuenta vieja), no "galpon's workspace".
2. El servicio o la base dice **Free**.
3. Su dirección `onrender.com` **no** lleva sufijo (es `galpon-mates-api.onrender.com`, no
   `galpon-mates-api-ab12.onrender.com`).

Si alguna no coincide, **no toques nada**: estás en la cuenta nueva.

---

# Parte 1. Sin corte

## Etapa 1. Una copia de respaldo de la base

No cambia nada en Render: solo lee. Sirve de respaldo y para el ensayo de la etapa 4. **No es la
copia que se muda:** esa se hace en la etapa 7, con la tienda ya cerrada.

- [ ] Cuenta **vieja** → `galpon-mates-db` → **Connect** → pestaña **External** → copiar la
      **External Database URL**.
- [ ] En PowerShell (común, sin administrador):

  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Users\lucas\Desktop\E-comers Marcos\backend\scripts\mudanza\copiar-base.ps1"
  ```

- [ ] Pegar la dirección cuando la pide (no se ve en pantalla, es a propósito) y Enter.

**Tiene que quedar:** en verde, `COPIA COMPLETA Y COMPROBADA: 30 tablas, todas con la misma
cantidad de filas que la original`, y en `C:\galpon-copia` un archivo `galpon-FECHA.dump` con su
`galpon-FECHA.conteo.txt`.

El script hace la copia, la carga en una base de prueba dentro de Docker (que borra al terminar) y
compara tabla por tabla contra la original.

En esta etapa la tienda sigue abierta: si justo entra un pedido o alguien usa el dashboard, el
cartel sale en **amarillo** con tablas de registro (`audit_logs`, `outbox_events`,
`webhook_events`, `idempotency_keys`). Es normal: volvé a correrlo o seguí. En la etapa 7 tiene
que salir en verde sí o sí.

## Etapa 2. Congelar los Blueprints de la cuenta vieja

Sin esto, al subir el código Render pasaría a planes pagos los servicios **viejos**, y al borrar
un servicio viejo lo volvería a crear.

- [ ] Cuenta **vieja** → **Blueprints** → entrar al del back → **Settings** → **Auto Sync: No**.
- [ ] Lo mismo en el Blueprint del front.

**Tiene que quedar:** los dos Blueprints con el estado **Sync paused**.

## Etapa 3. Preparar la cuenta nueva

- [ ] Cuenta **nueva** → **Billing** → cargar la tarjeta.
- [ ] Cuenta **nueva** → ícono de la cuenta → **Account Settings** → **Account Security** →
      **Git Deployment Credentials** → **Add credential** → GitHub → autorizar con el GitHub de
      Lucas (los repos son de él).

- [ ] Cuenta **vieja** → `galpon-mates-api` → **Environment**: comprobar que estén y se puedan
      ver `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SMTP_USER`,
      `SMTP_PASS`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Se copian en la etapa 8, ya con la tienda
      cerrada: mejor saber ahora si falta alguna.

**Tiene que quedar:** en **New → Blueprint**, la lista muestra los dos repos de Galpón. **No
apretar "Connect" todavía.**

Si los repos no aparecen: con el GitHub de Lucas, abrir
`github.com/apps/render/installations/new` y, en **Repository access**, incluir los dos repos.

## Etapa 4. Ensayar la carga contra Render

Es el único paso que no se puede ensayar en la compu: cargar la copia en un Postgres de Render de
verdad. Se hace con una base gratis aparte, que después se borra. Cuesta 0.

- [ ] Cuenta **nueva** → **New** → **Postgres**. Nombre `prueba-mudanza`, región **Virginia**,
      versión **17**, plan **Free**. Crear y esperar a que diga **Available**.
- [ ] En `prueba-mudanza` → **Connect** → pestaña **External** → copiar la **External Database
      URL**.
- [ ] En PowerShell:

  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Users\lucas\Desktop\E-comers Marcos\backend\scripts\mudanza\restaurar-base.ps1"
  ```

- [ ] Pegar la dirección (no se ve) y Enter. Si avisa que la copia es vieja, escribir
      `COPIA VIEJA` (acá es un ensayo). Después escribir `REEMPLAZAR`.
- [ ] **Correrlo una segunda vez**, igual. La primera carga sobre una base vacía; la segunda,
      sobre una con datos, que es lo que va a pasar en la mudanza.
- [ ] Borrar la base de prueba: `prueba-mudanza` → **Settings** → al pie, **Delete Database**.

**Tiene que quedar:** las dos veces, en verde, `BASE CARGADA Y COMPROBADA: 30 tablas`. Y la base
`prueba-mudanza` borrada.

Es la única cosa que se crea a mano en la cuenta nueva, y lleva otro nombre a propósito.

## Etapa 5. Subir el código

- [ ] El back primero:

  ```powershell
  git -C "C:\Users\lucas\Desktop\E-comers Marcos\backend" push origin main
  ```

- [ ] Después el front:

  ```powershell
  git -C "C:\Users\lucas\Desktop\E-comers Marcos\frontend" push origin main
  ```

Los servicios viejos se vuelven a desplegar con el mismo código. En la cuenta vieja todo es
gratis: no cobra nada.

**Tiene que quedar:** en GitHub, los dos repos con el último commit de hoy.

---

# Parte 2. El corte

De acá en adelante la página deja de andar hasta la etapa 12. Hacelo de corrido.

## Etapa 6. Cerrar la cuenta vieja: dominios y servicios

Un dominio no puede estar en dos servicios de Render a la vez. Y el back viejo no puede seguir
andando: tiene las claves reales de Mercado Pago y del mail, y sus tareas automáticas seguirían
mandando mails y venciendo pedidos sobre datos viejos.

- [ ] En el dashboard, **Pedidos**: si hay alguno esperando pago creado en los últimos 30
      minutos, esperar a que se pague o venza antes de seguir. Un pedido a medio pagar durante el
      corte puede terminar cobrado y sin registrar.

Después, las tres comprobaciones de "Antes de cada paso que borra o suspende algo".

En la cuenta **vieja**, en cada servicio → **Settings** → **Custom Domains** → borrar el dominio:

- [ ] `galpon-mates-api`: borrar `api.galponmates.com.ar`.
- [ ] `galpon-mates-tienda`: borrar `galponmates.com.ar` y, si `www.galponmates.com.ar` sigue en
      la lista, borrarlo también.
- [ ] `galpon-mates-admin`: borrar `admin.galponmates.com.ar`.

- [ ] **Esperar dos minutos**, para que el back viejo termine de mandar lo que tenga en cola
      (mails, devoluciones). El Redis no se muda: lo que quede en cola se pierde.

Después, suspender (al pie de **Settings** de cada servicio, el botón **Suspend**):

- [ ] Suspender `galpon-mates-api`.
- [ ] Suspender `galpon-mates-tienda`.
- [ ] Si hay que **renovar las claves de Mercado Pago**, es ahora: con el back viejo suspendido y
      antes de crear el nuevo.

**No borrar nada**, y **no tocar la base** (`galpon-mates-db`): hace falta para la etapa 7.

**Tiene que quedar:** los tres servicios viejos sin dominios propios, y el back y la tienda viejos
en **Suspended**.

## Etapa 7. La copia definitiva

Con la tienda cerrada ya no entra ningún pedido: esta copia tiene todo.

- [ ] Correr otra vez `copiar-base.ps1`, igual que en la etapa 1, con la External Database URL de
      la base **vieja**.

**Tiene que quedar:** en verde, `COPIA COMPLETA Y COMPROBADA`, y un archivo `.dump` nuevo en
`C:\galpon-copia` con la hora de recién. El script de carga usa siempre el más nuevo.

## Etapa 8. Crear el back en la cuenta nueva

- [ ] Cuenta **nueva** → **New** → **Blueprint** → **Connect** en el repo del **back**.
- [ ] Nombre del Blueprint: `galpon-mates`.
- [ ] En la pantalla de revisión, antes de aceptar, mirar que liste **exactamente** tres recursos
      y con esos nombres, **sin sufijo**: `galpon-mates-api`, `galpon-mates-db` y
      `galpon-mates-redis`.
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
  | `ADMIN_PASSWORD`        | Igual que en la cuenta vieja (ver la nota de abajo)          |

  Las tres direcciones van **sin barra al final**. Ninguna variable puede quedar vacía: sin las
  de Mercado Pago, Cloudinary o el mail, el back no arranca.

  Si `ADMIN_PASSWORD` ya no está en la cuenta vieja, inventá una de **12 caracteres o más**. Solo
  sirve hasta la etapa 9: después vale la contraseña de siempre, que viene en la copia.

- [ ] **Deploy Blueprint** y esperar a que `galpon-mates-api` diga **Live** (unos minutos).
- [ ] Comprobar los planes: en `galpon-mates-db` → **Info** tiene que decir 256 MB de memoria y
      **1 GB** de disco; en `galpon-mates-api` → **Settings** → **Instance Type**, 0,5 CPU y
      512 MB; `galpon-mates-redis`, **Free**.

**Tiene que quedar:** los tres recursos en verde (Live / Available), uno de cada uno. El back
arranca con el catálogo de ejemplo: es normal, la etapa 9 lo reemplaza por los datos reales.
Todavía nadie llega a él: el dominio `api` no apunta a ningún lado.

**Si falla, no vuelvas a hacer New → Blueprint:** eso crea un segundo juego de recursos pagos con
otro nombre. Entrá a **Blueprints**, abrí el que ya se creó y usá **Manual sync**. Si el back no
llega a **Live**, mirá **Logs**: si nombra una variable, corregila en **Environment** y usá
**Manual Deploy**.

Render pide estas variables **solo esta vez**. Después se cambian en `galpon-mates-api` →
**Environment**.

## Etapa 9. Cargar la copia en la base nueva

Reemplaza todo el contenido de la base nueva por el de la copia de la etapa 7. Va en una sola
transacción: si falla, la base nueva queda como estaba.

Va **antes** de pasar el dominio: si el back nuevo atendiera `api.galponmates.com.ar` con el
catálogo de ejemplo, un aviso de pago de Mercado Pago se daría por recibido y se perdería.

- [ ] Cuenta **nueva** → `galpon-mates-api`: anotar su dirección `onrender.com` (arriba, debajo
      del nombre; lleva un sufijo).
- [ ] Cuenta **nueva** → `galpon-mates-api` → **Settings** → al pie, **Suspend**. Así el back no
      usa la base mientras se carga.
- [ ] Cuenta **nueva** → `galpon-mates-db` → **Connect** → pestaña **External** → copiar la
      **External Database URL**.
- [ ] En PowerShell:

  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Users\lucas\Desktop\E-comers Marcos\backend\scripts\mudanza\restaurar-base.ps1"
  ```

- [ ] Pegar la dirección (no se ve) y Enter. Muestra qué copia va a cargar, de cuándo es y a qué
      servidor va. **La hora tiene que ser la de la etapa 7.** Si avisa que la copia es vieja,
      cancelar y repetir la etapa 7.
- [ ] Escribir `REEMPLAZAR` y Enter.
- [ ] Cuenta **nueva** → `galpon-mates-api` → **Settings** → al pie, **Resume**. Esperar a que
      vuelva a **Live**.

**Tiene que quedar:** en verde, `BASE CARGADA Y COMPROBADA: 30 tablas, todas con la misma cantidad
de filas que la copia`, y la dirección `onrender.com` del back nuevo, seguida de
`/api/v1/health`, respondiendo `"status":"ok"`.

El script se niega a seguir si se le pega la dirección de la base vieja o si la copia es de un
ensayo local.

**Si `pg_restore` falla, dejá el back nuevo suspendido** y no sigas a la etapa 10.

Después de esto, el usuario y la contraseña del dashboard son **los de siempre** (vienen en la
copia), no importa lo que se haya escrito en `ADMIN_PASSWORD`.

## Etapa 10. Pasar el dominio `api` al back nuevo

- [ ] Cuenta **nueva** → `galpon-mates-api` → **Settings** → **Custom Domains**: ahí está
      `api.galponmates.com.ar` y la dirección `onrender.com` a la que tiene que apuntar (no es la
      de antes: mientras exista el servicio viejo, la nueva lleva un sufijo).
- [ ] Cloudflare → registro `CNAME` `api` → cambiar el destino por esa dirección. **DNS only**
      (nube gris).
- [ ] En Render, **Verify** al lado del dominio. Si falla, esperar unos minutos y repetir.

**Tiene que quedar:** el dominio en **Verified** con **Certificate Issued**, y
`https://api.galponmates.com.ar/api/v1/health` respondiendo `"status":"ok"`.

## Etapa 11. Crear la tienda y el dashboard en la cuenta nueva

La tienda lee el catálogo de `https://api.galponmates.com.ar` al compilar: por eso las etapas 9 y
10 van antes.

- [ ] Cuenta **nueva** → **New** → **Blueprint** → **Connect** en el repo del **front**.
- [ ] Nombre del Blueprint: `galpon-mates-front`.
- [ ] En la revisión: exactamente dos servicios, **sin sufijo**: `galpon-mates-tienda` y
      `galpon-mates-admin`.
- [ ] Completar:

  | Variable                            | Valor                                               |
  | ----------------------------------- | --------------------------------------------------- |
  | `NEXT_PUBLIC_MP_PUBLIC_KEY`         | La Public Key de **producción** de Mercado Pago     |
  | `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | El mismo valor que `CLOUDINARY_CLOUD_NAME` del back |

  Revisá a mano la de Cloudinary: si queda vacía la tienda compila igual, pero no muestra fotos.

- [ ] **Deploy Blueprint** y esperar a que los dos digan **Live** (la tienda tarda varios minutos).
- [ ] Comprobar el plan: `galpon-mates-tienda` → **Settings** → **Instance Type**, 0,5 CPU y
      512 MB.

**Tiene que quedar:** los dos servicios en verde.

**Si falla, no vuelvas a hacer New → Blueprint:** abrí el Blueprint que ya se creó y usá
**Manual sync**. Si la tienda no compila, casi siempre es que `https://api.galponmates.com.ar`
no responde: revisá la etapa 10 y usá **Manual Deploy** en `galpon-mates-tienda`.

## Etapa 12. Pasar los dominios de la tienda y del dashboard

- [ ] Cuenta **nueva** → `galpon-mates-tienda` → **Settings** → **Custom Domains**: anotar su
      dirección `onrender.com`.
- [ ] Cloudflare → `CNAME` `@` y `CNAME` `www` → los dos hacia esa dirección. **DNS only**.
- [ ] Cuenta **nueva** → `galpon-mates-admin` → **Settings** → **Custom Domains**: anotar su
      dirección `onrender.com`.
- [ ] Cloudflare → `CNAME` `admin` → hacia esa dirección. **DNS only**.
- [ ] En Render, **Verify** en cada dominio.

**Tiene que quedar:** `galponmates.com.ar`, `www.galponmates.com.ar` y `admin.galponmates.com.ar`
en **Verified** con **Certificate Issued**. Acá termina el corte.

## Etapa 13. Comprobar

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
- [ ] Mercado Pago → **Actividad**: revisar los cobros aprobados desde que empezó el corte. Cada
      uno tiene que tener su pedido en **Pagado** o su devolución. Si alguno no, hay que
      resolverlo a mano.
- [ ] Una compra real de prueba (con tarjeta en el sitio y por Mercado Pago), ver el pedido en
      **Pagado**, el mail y el stock, y devolverla.

Los clientes que tenían la sesión iniciada tienen que volver a entrar: las sesiones no se mudan.

---

# Parte 3. Después

## Etapa 14. Borrar la cuenta vieja

Recién cuando la etapa 13 esté completa y hayan pasado unos días sin problemas. Antes de cada
borrado, las tres comprobaciones de "Antes de cada paso que borra o suspende algo".

- [ ] Cuenta **vieja** → **Blueprints** → en cada uno, **Settings** → desconectarlo o borrarlo.
      Si quedan, un "Manual sync" por error volvería a crear todo, ya en planes pagos.
- [ ] Borrar `galpon-mates-tienda`, `galpon-mates-admin`, `galpon-mates-api` y
      `galpon-mates-redis`.
- [ ] Borrar `galpon-mates-db` **al final**. Es gratis y vence sola alrededor del 2026-12-18.
- [ ] Borrar la carpeta `C:\galpon-copia`: tiene datos de clientes.

## Si algo sale mal

- **Antes de la etapa 6:** no se cambió nada. Se puede frenar y retomar otro día.
- **`pg_restore fallo`** en la etapa 9: la base nueva quedó como estaba. **Dejá el back nuevo
  suspendido** y mandá el mensaje de error (no trae la clave).
- **"La carga SI se hizo, pero no pude contar"**: volver a correr el script. Cargar dos veces la
  misma copia no hace daño.
- **El dashboard no deja entrar:** revisar que `ADMIN_ORIGIN` del back sea exactamente
  `https://admin.galponmates.com.ar`, sin barra al final.

### Volver a la cuenta vieja (después de la etapa 6)

En este orden, porque un dominio no puede estar en las dos cuentas:

1. Cuenta **nueva** → **suspender** `galpon-mates-api` y `galpon-mates-tienda`. No pueden quedar
   dos backs andando con las mismas claves de Mercado Pago y del mail: los dos vencerían pedidos
   y mandarían mails.
2. Cuenta **nueva** → **Blueprints** → en cada uno, **Settings** → **Auto Sync: No**.
3. Cuenta **nueva** → en cada servicio, **Settings** → **Custom Domains** → borrar los dominios
   propios (los cuatro, con el `www`).
4. Si se renovaron las claves de Mercado Pago: cargar las nuevas en la cuenta **vieja**,
   `galpon-mates-api` → **Environment**.
5. Cuenta **vieja** → reanudar `galpon-mates-api` y `galpon-mates-tienda` (**Resume**) y volver a
   agregar los dominios en cada servicio.
6. Cloudflare → los `CNAME` a las direcciones de antes: `galpon-mates-api.onrender.com`,
   `galpon-mates-tienda.onrender.com` y `galpon-mates-admin.onrender.com`.
7. **Verify** en cada dominio y esperar el certificado. Los servicios gratis tardan alrededor de
   un minuto en despertar.
8. Si no se va a reintentar en el día: borrar los recursos de la cuenta **nueva**, para que no
   facturen (la base cobra aunque el back esté suspendido).

La base vieja no se toca en ningún momento de la mudanza. Si se vuelve atrás, **lo que se haya
cargado o vendido en la cuenta nueva no está en la vieja**.

## Qué se ensayó y qué no

**Ensayado el 2026-11-26, en la compu de Lucas:**

- Los dos scripts, de punta a punta, con dos Postgres 17 en Docker, el esquema real del back (las
  15 migraciones y el catálogo inicial) y un usuario **sin** permisos de administrador, como el de
  Render: la copia, su comprobación y la carga sobre una base que ya tenía datos.
- Que el back arranca sobre la base cargada sin migraciones pendientes.
- Que `restaurar-base.ps1` se niega con la dirección de la base de origen (también escrita en
  mayúsculas), con una Internal Database URL, con una clave equivocada y con una copia de ensayo,
  sin tocar nada; y que avisa cuando la copia tiene más de una hora.
- Que copiar solo el esquema `public` (lo que sugiere la guía general de Render) **no sirve** acá:
  la extensión `citext` vive en ese esquema y la carga falla. Por eso la copia va completa.
- La copia real de la base de producción (30 tablas, comprobada).

**Confirmado en la documentación oficial de Render (2026-11-26):**

- Los identificadores de plan y que `diskSizeGB` vale 1 o un múltiplo de 5 y no se puede achicar
  ([blueprint-spec](https://render.com/docs/blueprint-spec)); los dos `render.yaml` validan contra
  el [esquema oficial](https://render.com/schema/render.yaml.json).
- Auto Sync en "No" frena los cambios de `render.yaml`, pero no el redespliegue de cada servicio
  al subir código ([infrastructure-as-code](https://render.com/docs/infrastructure-as-code)).
- Crear dos veces el mismo Blueprint en una cuenta duplica los recursos, con un sufijo en el
  nombre.
- Las variables `sync: false` se piden solo al crear el Blueprint, y `fromService` puede apuntar a
  un servicio de otro Blueprint de la misma cuenta.
- Los registros de Cloudflare: `CNAME` en "DNS only", sin registros `AAAA`
  ([configure-cloudflare-dns](https://render.com/docs/configure-cloudflare-dns)).
- Una misma cuenta de GitHub sirve de credencial de despliegue en varias cuentas de Render
  ([login-settings](https://render.com/docs/login-settings)).
- El plan pago de 0,5 CPU deja salir mails por el puerto 587.

**No confirmado (sale del foro de Render o no está en la doc):**

- Qué hace Render si un Blueprint nuevo declara un dominio que sigue en otra cuenta. Por eso los
  dominios se sacan antes (etapa 6).
- Cómo cuenta el `www` para el cupo de 2 dominios incluidos.
- Cuánto tarda la verificación de un dominio: la doc solo dice "unos minutos".
- El nombre exacto de los botones para suspender un servicio y para desconectar un Blueprint.
