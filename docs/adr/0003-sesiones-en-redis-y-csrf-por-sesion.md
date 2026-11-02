# ADR 0003 · Sesiones en Redis y CSRF por sesión

- **Estado:** aceptada (aplicada en B3, 2026-11-02).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §3.3, §4.1, §6 y §8.
- **Plan:** [`docs/superpowers/plans/2026-11-02-b3-identidad.md`](../superpowers/plans/2026-11-02-b3-identidad.md) (Rulings B-4 a B-7).

## Contexto

B3 suma clientes y admin. El contrato del front (`../frontend/docs/api/openapi.yaml`) ya fija cómo
se autentican:

- Dos cookies opacas: `__Host-galpon_session` para la tienda y `__Host-galpon_admin` para el admin.
- Un token anti-CSRF que el front pide (`GET /auth/csrf`, `GET /admin/auth/csrf` o la respuesta del
  login del admin) y devuelve en `X-CSRF-Token` en cada escritura.
- `403 csrf_invalid` si el token falta o no coincide.

La tienda llama al back desde su servidor y reescribe `/api/v1/*`, así que el navegador solo habla
con la tienda. El admin es otra SPA en otro origen y llama directo, con credenciales (CORS solo para
`ADMIN_ORIGIN`).

Requisitos que salen del spec y de los Rulings:

- **Revocación:** cerrar sesión, y que un cambio de contraseña por recuperación cierre todas las
  sesiones del usuario.
- **Duración fija:** anónima 24 h (solo para dar el CSRF de la tienda), cliente 30 días y admin 8 h,
  sin renovación.
- **Sin Redis no se entra:** si Redis cae, ninguna ruta con sesión deja pasar.
- **Un freno al adivinado de contraseñas.**

## Decisión

1. **Sesiones del lado del servidor, en Redis, detrás de `SessionPort`** (`src/shared/application/ports/session.port.ts`;
   adaptador `RedisSessionStore` en `src/shared/infrastructure/session/`):
   - `session:{id}` guarda un JSON con `kind` (`anonymous`, `customer` o `admin`), `userId`,
     `customerId`, `csrfToken`, `createdAt` y `expiresAt`. Vence con `EX` según el tipo
     (`SESSION_TTL_SECONDS`: 86 400, 2 592 000 y 28 800 s).
   - El vencimiento es fijo: no se renueva con el uso.
   - `user-sessions:{userId}` es un set que indexa las sesiones de cada usuario, para cerrarlas
     todas juntas.
   - `create` escribe la sesión y el índice en un solo `MULTI`.
   - El id de sesión y el token CSRF son 32 bytes aleatorios en hex (`SecretsPort.token`), no
     UUID.
   - Un usuario puede tener varias sesiones a la vez.
2. **CSRF con token sincronizado, ligado a la sesión:**
   - Cada sesión tiene su `csrfToken`. Los guards (`CustomerCsrfGuard`, `AdminCsrfGuard`) lo
     comparan con `X-CSRF-Token` con `timingSafeEqual`.
   - Si falta la cookie, la sesión o el header, o el token no coincide, responden 403
     `csrf_invalid` "Token CSRF inválido" / "El token CSRF falta o no es válido.". Vale igual para
     el cliente y para el admin.
   - `GET /auth/csrf` sin una sesión válida abre una anónima.
   - **Rotación:** registrarse o iniciar sesión destruye la sesión anterior (y su token) y crea una
     nueva con otro id y otro token. Así se evita la fijación de sesión, y el front vuelve a pedir
     el CSRF.
3. **Cookies `__Host-`, siempre con `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<ttl>`,**
   también en desarrollo:
   - Chrome y Firefox aceptan cookies `Secure` desde `http://localhost`, porque lo tratan como
     contexto seguro.
   - El logout manda la misma cookie vacía con `Max-Age=0`.
   - Los nombres son los del contrato. El `proxy.ts` de la tienda busca ese nombre exacto.
   - Las arman `sessionCookie` y `clearedSessionCookie` (`src/shared/infrastructure/auth/cookies.ts`).
4. **Falla cerrada:**
   - Cualquier error de Redis en el almacén de sesiones sale como 503 `service_unavailable` ("No
     pudimos verificar tu sesión…"), con un `warn` como mucho por minuto.
   - La caché y el throttler siguen fallando abiertos (B1): sin Redis se lee de Postgres y el
     límite cae a memoria.
5. **Freno al adivinado, en dos capas:**
   - `@Throttle` de 20 pedidos por minuto por IP en el registro, los dos logins, `forgot` y `reset`
     (el resto queda en el global de 120 por minuto).
   - Un bloqueo por email: `login-fail:{email}` con `INCR` + `EXPIRE 900 NX`. Desde el décimo fallo
     en 15 minutos responde 429 `rate_limited` con `Retry-After`, y durante la ventana tampoco
     entra la contraseña correcta.
   - Cuenta cualquier fallo: contraseña mala, email inexistente, otro rol o cuenta deshabilitada.
     Todos dan el mismo 401 `invalid_credentials`. Un email desconocido igual verifica contra un
     hash fijo, para que el tiempo de respuesta no lo delate.
   - El bloqueo falla abierto sin Redis: queda el límite por IP.
6. **Contraseñas y recuperación:**
   - Contraseñas con argon2id (19 MiB, t=2, p=1).
   - El token de recuperación es `rt_` + 64 hex. En la base se guarda solo su SHA-256, vence en 60
     minutos y es de un solo uso (`updateMany` condicional).
   - Restablecer la contraseña cierra todas las sesiones del usuario.
   - El mail sale por `MailerPort`. Hasta B7, un adaptador lo registra en el log, con el link solo
     fuera de producción.
7. **Nada secreto en los logs:** pino tapa `Cookie`, `Set-Cookie`, `Authorization`, `Referer` y
   `X-CSRF-Token`.
   - `Referer` se sumó en la Task 6. En la prueba en vivo, la tienda reenviaba al back la URL
     `/cuenta/restablecer?token=rt_…` como `Referer`, y el token terminaba en el log.
   - Los cuerpos de `/auth/*` y `/admin/auth/*` no se loguean.

## Consecuencias

- Logout, recuperación y bloqueo de cuentas funcionan al instante, sin listas de tokens
  revocados: borrar la clave alcanza.
- Cada pedido con sesión hace un `GET` a Redis. Es barato, y Redis ya era parte de la operación.
  Sin Redis, la cuenta y el admin no andan (503), pero el catálogo sí.
- La cookie es opaca y chica: no lleva datos del usuario y no hace falta firmarla.
- Safari no acepta cookies `Secure` desde `http://localhost`, así que en local se prueba con Chrome
  o Firefox. En producción todo va por HTTPS.
- Límites conocidos, todos anotados en la bitácora para más adelante:
  - `destroyAllForUser` lee el set y después borra. Una sesión creada en ese instante sobrevive.
    El set `user-sessions:*` tampoco se poda: crece con cada login hasta que vence (30 días). Un
    script Lua cerraría las dos cosas.
  - Si Redis cae justo después de cambiar la contraseña en un `reset`, el token ya se usó y las
    sesiones viejas siguen vivas: la respuesta es 503.
  - Restablecer la contraseña no limpia el bloqueo por email: quien se bloqueó espera hasta 15
    minutos.
  - En el cambio de contraseña del admin, la contraseña actual mal no cuenta para el bloqueo. Solo
    lo frena el límite global por IP.
  - Al registrarse con el email de un invitado (B4), la cuenta adopta ese cliente sin verificar el
    email. Es lo que promete la tienda ("tus pedidos aparecen en tu cuenta apenas la creás") y el
    contrato no pide verificación. Hay que revisarlo cuando B4 cree invitados.
  - `forgot` hace más trabajo cuando la cuenta existe (insert + mail). El proveedor de B7 tiene que
    encolar el envío y no lanzar errores, para que la respuesta siga siendo siempre 202 y tarde lo
    mismo.
  - Producción (B8):
    - `trust proxy`, para que los límites por IP vean la IP real.
    - Que el admin semilla no use la contraseña pública del demo.
    - `NODE_ENV=production` obligatorio. Si falta, el `LogMailer` registraría los links.
    - `exposedHeaders: ['Retry-After']` en CORS, si el admin llega a mostrar la espera.

## Alternativas descartadas

- **JWT (tokens firmados sin estado):**
  - No se pueden revocar sin una lista de bloqueados en Redis, que vuelve a poner estado del lado
    del servidor.
  - Cerrar todas las sesiones al restablecer la contraseña, o echar a alguien, se complica.
  - El token viaja más grande en cada pedido.
  - El contrato no lo pide: define cookies opacas y un CSRF aparte.
- **`express-session` (con `connect-redis`):**
  - Es un middleware global de Express, con su propio formato de cookie (firma `s:`) y renovación
    configurable. No encaja en `SessionPort` ni en los guards por tipo de sesión de la arquitectura
    hexagonal (ADR 0001).
  - No indexa las sesiones por usuario.
  - No falla cerrado de forma explícita.
  - Los atributos y nombres de las cookies del contrato quedarían a merced de su configuración.
- **`csrf-csrf` (doble envío con cookie firmada) y `csurf` (abandonado):**
  - Suman otra cookie y otro secreto.
  - Con sesiones del servidor ya existentes, guardar el token en la sesión es más simple y más
    fuerte: no depende de que el navegador aísle cookies por subdominio.
  - Es lo que describe el contrato: el token se pide a la API y va en el header.
