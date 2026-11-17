# B7 · Mails y datos personales — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el back mande los mails que la tienda ya promete y que la ley exige (la confirmación del pedido, CCyC 1108), y que trate los datos personales con plazos de conservación, purga y logs sin datos de más.

**Architecture:** un puerto único de envío (`MailPort`) con dos adaptadores (`log` y SMTP con `nodemailer`), elegido por `MAIL_MODE`. Un módulo `notifications` arma cada mail con plantillas puras y lo manda por una cola propia con reintentos; se dispara con los eventos del outbox que ya existen más tres nuevos. Un módulo `privacy` corre una purga diaria con plazos fijos. La Task 3 sigue el contrato nuevo del front (documentos legales `cookies` y `returns`, enlaces de consumidor, `DELETE /me`) y la Task 4 cierra.

**Tech Stack:** lo de B1–B6 más `nodemailer` (versión exacta, única dependencia nueva).

**Spec:** decisiones en `.superpowers/sdd/2026-11-04-legal-seguridad/rulings.md` (LS-5, LS-6, LS-10; LS-1 no se discute). Fuentes: `research-leyes.md` (tabla (a) filas 2, 4, 17, 22; §4 datos personales) y `audit-datos-terceros-afirmaciones-imagenes.md` (§1 datos y logs) en esa carpeta. Estado del back: `docs/BITACORA.md` (sección "Seguridad: arreglos de la auditoría") y los reportes `seguridad-*-report.md` de ese workspace.

## Global Constraints

- Las de B1–B6 siguen: solo commits locales en `main`, nunca `git push`; fronteras con `eslint-plugin-boundaries` (`application` sin `@nestjs/*` ni `node:*`, casos de uso con `useFactory`); Prisma solo desde `src/generated/prisma/client`; TS estricto; TSDoc en español; textos en español rioplatense; `problem+json`. **El contrato no cambia en las Tasks 1 y 2** (`npm run contract:check` contra `../frontend/docs/api/openapi.yaml` sigue en verde).
- **Mails** (LS-6): `MAIL_MODE` `log | smtp` (por defecto `log`; en `production` tiene que ser `smtp`, con `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`; error de arranque en español si falta alguno). El adaptador de log nunca escribe el destinatario entero (`l***@dominio.com`) ni el cuerpo. Todos los mails salen por la cola `mails` (5 intentos, backoff exponencial, `jobId` = id del evento + plantilla: un evento repetido no manda dos mails). El enlace de restablecer contraseña va directo a la cola (no pasa por `outbox_events`, para no guardar el token en Postgres) y su job se borra al completarse. Texto plano + HTML simple, sin imágenes remotas, sin píxeles ni enlaces de rastreo. Sin newsletter.
- **Plantillas** (una función pura por mail, con test): `order-received` (evento `order.created`: número, líneas, total, que el pago está pendiente y hasta cuándo se reserva, derecho de arrepentimiento de 10 días con enlace, enlaces a `/terminos` y `/devoluciones`, datos del vendedor desde ajustes), `payment-approved` (`order.paid`), `order-shipped` (`order.shipped`: empresa y seguimiento), `order-delivered` (`order.delivered`), `order-cancelled` (`order.cancelled` y `order.expired`, con el motivo en una línea), `withdrawal-code` (evento nuevo `withdrawal.requested`: el código `ARR-…`), `contact-received` (evento nuevo `contact.received`), `password-reset` (directo a la cola), `account-created` (evento nuevo `customer.registered`) y `account-deleted` (queda lista; la conecta la Task 3 con `DELETE /me`). Los enlaces usan `STORE_ORIGIN`. Un mail va siempre al email del pedido o de la cuenta, nunca a otro.
- **Eventos nuevos** (mismo patrón que los de pedidos, en la misma transacción que la escritura): `withdrawal.requested { requestId }`, `contact.received { messageId }`, `customer.registered { customerId }`. El payload lleva ids, nunca emails ni nombres; el handler lee los datos al mandar.
- **Datos personales** (LS-5): plazos en un solo archivo de dominio y escritos en `docs/adr/0008-datos-personales.md`: claves de idempotencia 48 h desde que se crean; tokens de restablecer contraseña 7 días después de vencer; mensajes de contacto 24 meses; eventos de webhook procesados y eventos del outbox publicados 90 días; reseñas pendientes o rechazadas 12 meses; pedidos y solicitudes de arrepentimiento 10 años (no se purgan en esta pieza: se documenta). La purga corre una vez por día con el patrón de los barridos existentes (`order-expiration.sweep.ts`), borra por lotes y loguea solo cantidades. Se borran las columnas sin uso `customers.document_type` y `customers.document_number`.
- **Logs:** el log de cada pedido HTTP guarda la ruta sin los valores de la query (solo los nombres de los parámetros); nada de emails en claro.

## Review Focus

1. **Un evento repetido no manda dos mails:** el relay reintenta `order.paid` → un solo job y un solo envío (test en Task 1).
2. **El mail va a quien corresponde y con lo justo:** el de un pedido de invitado va al email del pedido, sin datos de otra cuenta; el log en modo `log` no muestra el email entero ni el cuerpo (Task 1).
3. **SMTP caído no rompe la compra:** con el servidor de mails rechazando, `POST /orders` y el pago responden igual y el job reintenta; agotados los intentos queda en fallidos con un `warn` sin datos personales (Task 1).
4. **La purga no borra de más:** un pedido de hace 9 años, una reseña aprobada vieja y una clave de idempotencia de 47 h siguen; una de 49 h, un mensaje de 25 meses y una reseña rechazada de 13 meses se van (Task 2).
5. **La búsqueda del admin no queda en los logs:** `GET /admin/orders?q=juan@mail.com` loguea la ruta y `q` como nombre, sin el valor (Task 2).

---

### Task 1: Mails con SMTP genérico, plantillas, cola y eventos

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm install --save-exact nodemailer@<última estable>` y `--save-dev --save-exact @types/nodemailer` solo si el paquete no trae tipos), `scripts/dependency-versions.json`
- Modify: `src/config/env.schema.ts` (+ spec), `.env.example`, `README.md` (sección "Mails": qué variables cargar y cómo probar)
- Create: `src/shared/application/ports/mail.port.ts`; `src/modules/notifications/**` (dominio con las plantillas y sus specs, puertos de lectura, handlers del outbox, cola, procesador, adaptadores `log` y SMTP, módulo)
- Modify: `src/app.module.ts`; `src/modules/identity/**` (el mail de restablecer contraseña pasa por la cola; evento `customer.registered`); `src/modules/support/**` (eventos `withdrawal.requested` y `contact.received`)
- Test: specs unitarios de cada plantilla, del adaptador SMTP (con el transporte de prueba de `nodemailer`, sin red) y de los handlers; `test/e2e/mails.e2e-spec.ts`; `test/support/` (doble de `MailPort` para `createApp({ mailer })`)

**Interfaces:**
- Produces: `MailPort { send(mail: OutgoingMail): Promise<void> }` con `OutgoingMail { to: string; subject: string; text: string; html: string; template: MailTemplate }`, token `MAIL_PORT`; `MailTemplate` = los diez nombres de arriba; cola `mails`, job `mail.send`; eventos `WITHDRAWAL_REQUESTED_EVENT`, `CONTACT_RECEIVED_EVENT`, `CUSTOMER_REGISTERED_EVENT`; plantilla `account-deleted` exportada para la Task 3.
- Consumes: `OutboxHandlerRegistry` (los handlers se registran en su constructor), `OutboxRepository.append`, los eventos de pedidos de `orders/domain/order-events.ts`, los ajustes públicos (vendedor y email de contacto).

- [ ] **Step 1:** tests que fallan: una spec por plantilla con sus datos y asserts de asunto y de las frases obligatorias (por ejemplo `order-received` contiene el número `GLP-10001`, el total con formato `$61.999`, "10 días corridos" y los enlaces a `/terminos` y `/devoluciones`); entorno (`production` con `MAIL_MODE=log` → error; `smtp` sin `SMTP_HOST` → error); handlers (Review Focus 1 y 2); E2E: crear un pedido → un mail `order-received` al email del pedido; pagar con el simulador → `payment-approved`; despachar desde el admin → `order-shipped` con empresa y seguimiento; arrepentimiento → `withdrawal-code` con el código; contacto → `contact-received`; registro → `account-created`; olvidé mi contraseña → `password-reset` con el enlace; Review Focus 3.
- [ ] **Step 2:** instalar `nodemailer`, variables de entorno, `MailPort` y adaptadores, plantillas, cola y procesador, handlers, eventos nuevos y sus emisiones.
- [ ] **Step 3:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:e2e`, `npm run contract:check`.
- [ ] **Step 4:** commit `feat(notifications): mails de pedidos, pagos, envíos, arrepentimiento, contacto y cuenta por SMTP`.

### Task 2: Datos personales: purga, columnas sin uso y logs

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/<timestamp>_b7_datos_personales/migration.sql`
- Create: `src/modules/privacy/**` (dominio con los plazos, comando de purga, puerto, adaptador Prisma, barrido diario, módulo); Modify: `src/app.module.ts`
- Modify: `src/shared/infrastructure/logger/**` (+ spec)
- Create: `docs/adr/0008-datos-personales.md`; Modify: `docs/BITACORA.md`
- Test: specs del comando con un reloj fijo; `test/e2e/privacy.e2e-spec.ts`; `test/e2e/prisma.e2e-spec.ts` si toca

**Interfaces:**
- Consumes: el reloj (`CLOCK`), Prisma; nada de la Task 1.
- Produces: `RETENTION` (plazos), `PurgeExpiredDataCommand.execute(now): Promise<PurgeSummary>` con una cantidad por tipo de dato.

- [ ] **Step 1:** tests que fallan: Review Focus 4 (unitario con dobles y E2E contra Postgres con filas fechadas a mano) y 5; que ninguna parte del código lee `documentType`/`documentNumber`.
- [ ] **Step 2:** migración, módulo `privacy`, barrido, logger.
- [ ] **Step 3:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:e2e`, `npm run contract:check`.
- [ ] **Step 4:** commit `feat(privacy): purga diaria con plazos de conservación, columnas sin uso y logs sin datos de más`.

### Task 3: Seguir el contrato nuevo del front: documentos legales, enlaces de consumidor y eliminar la cuenta

El contrato ya está commiteado en el front (rama `feat/legal-accesibilidad`, commit `232c24d`, worktree `C:/Users/lucas/.galpon-trabajo/frontend-legal`). Desde esta tarea, el contrato y los E2E corren con `CONTRACT_PATH="C:/Users/lucas/.galpon-trabajo/frontend-legal/docs/api/openapi.yaml"`. La fuente es la sección "Legales, datos del vendedor y eliminar la cuenta: cambios que el back tiene que implementar" de `C:/Users/lucas/.galpon-trabajo/frontend-legal/docs/api/README.md` y las `description` del YAML; los casos son los de `validation-cases.json` de esa carpeta (`Admin · documento legal`, `Admin · enlaces de Defensa del Consumidor`, `Admin · Data Fiscal`, `Eliminar la cuenta`, los 26 de ajustes con `consumerLinks` y los 3 del pie sin el enlace).

**Files:**
- Modify: `src/modules/content/**` (documentos `cookies` y `returns`: claves `legal-cookies` y `legal-returns`, etiquetas `content:legal-{document}`; validación de marcadores; `FooterContent` sin `consumerDefenseUrl`), `src/modules/settings/**` (`consumerLinks`, `dataFiscalUrl` con el código pegado), `src/modules/storefront-sync/**` solo si el patrón de etiquetas no admite las nuevas
- Modify: `src/modules/identity/**` (`DELETE /me`), `src/modules/notifications/**` (conectar `account-deleted`)
- Modify: `prisma/schema.prisma` + migración `b7_contrato_legal` (lo que haga falta para `consumerLinks` y para anonimizar), `scripts/import-fixtures.mjs`, `prisma/seed.ts`, `prisma/seed-data/**`
- Modify: `test/contract/**` (operación `DELETE /me` y los mappings de los casos nuevos), E2E de contenido, ajustes y cuenta

**Interfaces:**
- Consumes: de la Task 1, `MailPort`, la cola `mails` y la plantilla `account-deleted`; de la tanda de seguridad, `SessionPort.destroyAllForUser`, el bloqueo de login (`LoginAttemptsPort`) y `StorableText`.
- Produces: `DeleteAccountCommand.execute(userId, { password }, context)`; `LEGAL_MARKERS` (las 8 claves, copia de `@galpon/domain`).

- [ ] **Step 1:** tests que fallan. Contrato: `DELETE /me` en las operaciones implementadas y 0 diferencias con el contrato nuevo. Legales: `GET /content/legal/cookies` y `/returns` → 200 con el texto del seed; `/legal/otro` → 404 "No existe ese documento legal."; `PUT /admin/content/legal/terms` con `{{cuitt}}` → 422 `{ field: 'body', code: 'custom', message: 'El dato {{cuitt}} no existe. Revisá la lista de datos del vendedor.' }`, y con un marcador válido se guarda tal cual. Ajustes: `GET /settings` trae `consumerLinks` con los valores de fábrica; `PUT /admin/settings` sin `consumerLinks` → 422 "Requerido"; con el código de ARCA pegado en `dataFiscalUrl` guarda solo el `href`. Cuenta: contraseña equivocada → 422 `{ field: 'password', code: 'invalid_password', message: 'La contraseña no es correcta' }` y nada cambia; contraseña correcta → 204, cookie borrada, el login con ese email y esa contraseña ya no entra, las direcciones no existen, todas las sesiones del usuario quedan cerradas, `GET /orders/{number}` con el token del pedido sigue respondiendo 200 con los datos del comprobante, `GET /me/orders` de una cuenta nueva con el mismo email no trae esos pedidos, y sale un mail `account-deleted` al email que tenía la cuenta; 401 sin sesión y 403 sin token CSRF. Diez contraseñas equivocadas seguidas en `DELETE /me` cuentan para el mismo bloqueo que el login.
- [ ] **Step 2:** implementar. La anonimización recorre **todas** las tablas con vínculo al cliente o al usuario o con su email (cliente, usuario, direcciones, sesiones, tokens de contraseña, reseñas, mensajes de contacto, solicitudes de arrepentimiento, pedidos) y decide una por una; lo que se conserva por los 10 años (pedidos y arrepentimientos, con los datos del comprobante) queda sin vínculo a la cuenta. La decisión por tabla se escribe en `docs/adr/0008-datos-personales.md`. El mail `account-deleted` se encola directo con el destinatario leído antes de anonimizar (como el de contraseña), y su job se borra al completarse.
- [ ] **Step 3:** importador y seed: los cuatro textos legales y `consumerLinks` desde las fixtures del front (`FIXTURES_PATH="C:/Users/lucas/.galpon-trabajo/frontend-legal/packages/api-client/src/mock/fixtures/index.ts"`); una base ya sembrada suma `legal-cookies`, `legal-returns` y `consumerLinks` si faltan, sin pisar lo que el admin guardó.
- [ ] **Step 4:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, y con el `CONTRACT_PATH` nuevo `npm run test:e2e` y `npm run contract:check` (84 operaciones implementadas, 0 diferencias).
- [ ] **Step 5:** commit `feat(legal): documentos de cookies y devoluciones, enlaces de consumidor y eliminar la cuenta`.

### Task 4: Cierre: verificación global, prueba con un servidor de mails falso y documentos

**Files:**
- Modify: `README.md`, `docs/BITACORA.md` (B7); Create: `docs/LANZAMIENTO-LEGAL.md`
- Capturas y registros en `.superpowers/sdd/2026-11-04-legal-seguridad/captures/`

- [ ] **Step 1:** verificación global con el `CONTRACT_PATH` nuevo: typecheck, lint, format, unitarios, E2E y contrato.
- [ ] **Step 2:** prueba en vivo solo del back (los fronts están ocupados por otras corridas): back compilado en el puerto **3021** con `docker compose up -d`, el seed, `MAIL_MODE=smtp` apuntando a un servidor SMTP falso local (un script chico con `node:net` en el scratchpad, que guarde cada mensaje en un archivo; nada de internet), `MP_MODE=simulated`. Con `curl`: crear un pedido, pagarlo con el simulador, despacharlo desde el admin, pedir un arrepentimiento, mandar un contacto, registrar una cuenta, pedir restablecer la contraseña y eliminar la cuenta; guardar los ocho mails recibidos (asunto y texto) como evidencia y comprobar que ninguno va a un destinatario equivocado. Bajar todo al terminar.
- [ ] **Step 3:** `docs/LANZAMIENTO-LEGAL.md` (LS-10): lo que el código no puede hacer y tiene que hacer Lucas, el dueño, el abogado o el contador (inscripción en el Registro Nacional de Bases de Datos, revisión de los cuatro textos, cálculo del precio neto, promoción de cuotas real en Mercado Pago, cesión escrita de las fotos, marca en el INPI, consentimiento del socio, contratos con proveedores en el exterior, cuenta SMTP y sus variables, `TRUST_PROXY` con un proxy delante de la tienda, Cloudinary), las afirmaciones y las fotos a confirmar por el dueño (tomá la lista de `C:/Users/lucas/.galpon-trabajo/frontend-legal/.superpowers/sdd/2026-11-09-legal-accesibilidad/task-2-report.md` y de `audit-datos-terceros-afirmaciones-imagenes.md`), los riesgos aceptados de LS-1 con su norma (botón de arrepentimiento solo en el pie: Disp. 954/2025; "Los más vendidos" y reseñas de ejemplo con sello: DNU 274/2019) y lo que queda pendiente de la auditoría de seguridad (verificación del email de las cuentas, formato del número de pedido).
- [ ] **Step 4:** commit `docs: bitácora de B7, lanzamiento legal y README`.
