# ADR 0008 · Datos personales: plazos, purga y logs

- **Estado:** aceptada (aplicada en B7, 2026-11-17).
- **Plan:** [`docs/superpowers/plans/2026-11-17-b7-mails-datos.md`](../superpowers/plans/2026-11-17-b7-mails-datos.md) (Task 2).
- **Decisión de origen:** Ruling LS-5 (`.superpowers/sdd/2026-11-04-legal-seguridad/rulings.md`).

## Contexto

La Ley 25.326 pide no guardar datos personales más tiempo del necesario para su finalidad. El back
guardaba todo para siempre: claves de idempotencia con la respuesta del pedido (email, nombre,
dirección), tokens de contraseña vencidos, mensajes de contacto, eventos de webhook y del outbox,
y reseñas que nadie iba a publicar. Además `customers` tenía dos columnas que nada usaba
(`document_type`, `document_number`), y el log de cada pedido HTTP escribía la URL completa: la
búsqueda del admin (`GET /admin/orders?q=juan@mail.com`) dejaba emails y nombres en los logs.

## Decisión

1. **Plazos en un solo lugar:** `RETENTION` en `src/modules/privacy/domain/retention.ts`. La
   política de privacidad de la tienda dice lo mismo.

   | Dato                                                                       | Se borra                  | Fecha de referencia                         |
   | -------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- |
   | Claves de idempotencia (`idempotency_keys`)                                | a las 48 h                | `created_at`                                |
   | Tokens de restablecer contraseña                                           | 7 días después de vencer  | `expires_at`                                |
   | Mensajes del formulario de contacto (`contact_messages`, `kind = contact`) | a los 24 meses            | `created_at`                                |
   | Eventos de webhook procesados                                              | a los 90 días             | `processed_at` (los sin procesar se quedan) |
   | Eventos del outbox publicados                                              | a los 90 días             | `published_at` (los sin publicar se quedan) |
   | Reseñas pendientes u ocultas (rechazadas)                                  | a los 12 meses            | `created_at`                                |
   | Pedidos, pagos, devoluciones y solicitudes de arrepentimiento              | 10 años                   | no se purgan acá                            |
   | Reseñas aprobadas                                                          | mientras estén publicadas | no se purgan                                |

   La purga de reseñas cuenta desde que se escribieron (`created_at`), no desde que se moderaron:
   una reseña aprobada que después el admin oculta se purga a los 12 meses de escrita (si ya los
   pasó, en la purga siguiente).

   Los 10 años son la obligación de conservar registros comerciales (CCyC art. 328); cuando
   lleguen los primeros vencimientos (2036) se suma ese paso.

2. **Purga diaria** (`src/modules/privacy`): `PurgeExpiredDataCommand.execute(now)` calcula los
   cortes con `purgeCutoffs(now)` y borra cada tipo de a lotes de 500
   (`DELETE … WHERE ctid IN (SELECT ctid … LIMIT 500)`) hasta que un lote sale incompleto.
   `PrivacyPurgeSweep` la corre a los 5 minutos de arrancar y después cada 24 h (con
   `NODE_ENV=test` no arranca: los E2E llaman a `runOnce`), y loguea solo cantidades. Si falla,
   avisa con `warn` y la vuelta siguiente sigue; lo ya borrado queda borrado.
3. **Columnas sin uso fuera:** migración `20261117120000_b7_datos_personales` borra
   `customers.document_type` y `customers.document_number` (nadie las leía ni escribía: ni el
   código, ni el seed, ni los tests).
4. **Logs sin datos de más:** `serializeRequest` (`src/shared/infrastructure/logger`) deja en el
   log de cada pedido HTTP la ruta sin la query y, de la query, solo los nombres
   (`"url":"/api/v1/admin/orders","query":["q"]`); tampoco van los parámetros de la ruta (ya están
   en la ruta). Siguen enmascaradas las cabeceras sensibles (cookies, tokens, `Referer`,
   `Idempotency-Key`). La IP y el user-agent se conservan por seguridad y se declaran en la
   política. El mailer de log enmascara el destinatario (Task 1).

## Consecuencias

- Una repetición idempotente después de 48 h ya no encuentra la clave: el TTL de la clave es de
  24 h, así que no cambia nada para el cliente.
- Un mensaje de contacto de más de 24 meses desaparece de la bandeja del dashboard; los
  arrepentimientos no.
- Si se agrega una tabla con datos personales, su plazo va en `RETENTION`, en `PURGE_TARGETS` y en
  `PrismaExpiredDataRepository`, con su test.
