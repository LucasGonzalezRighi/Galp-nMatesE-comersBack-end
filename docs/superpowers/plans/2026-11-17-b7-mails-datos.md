# B7 · Mails y datos personales — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el back mande los mails que la tienda ya promete y que la ley exige (la confirmación del pedido, CCyC 1108), y que trate los datos personales con plazos de conservación, purga y logs sin datos de más.

**Architecture:** un puerto único de envío (`MailPort`) con dos adaptadores (`log` y SMTP con `nodemailer`), elegido por `MAIL_MODE`. Un módulo `notifications` arma cada mail con plantillas puras y lo manda por una cola propia con reintentos; se dispara con los eventos del outbox que ya existen más tres nuevos. Un módulo `privacy` corre una purga diaria con plazos fijos. Las tareas que siguen el contrato nuevo del front (documentos legales `cookies` y `returns`, enlaces de consumidor, `DELETE /me`) y el cierre se detallan cuando el front commitee ese contrato.

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

### Task 3: Seguir el contrato nuevo del front (se detalla cuando el front lo commitee)

Documentos legales `cookies` y `returns`, enlaces de consumidor y datos del vendedor en ajustes, y `DELETE /me` (anonimiza al cliente, borra direcciones y sesiones, emite `customer.deleted` y manda `account-deleted`).

### Task 4: Cierre (se detalla después de la Task 3)

Seed al día con las fixtures del front, verificación global, prueba en vivo con un servidor SMTP falso local y `docs/LANZAMIENTO-LEGAL.md` (LS-10).
