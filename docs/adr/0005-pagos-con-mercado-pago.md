# ADR 0005 · Pagos con Mercado Pago

- **Estado:** aceptada (aplicada en B5, 2026-11-03).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §3.2, §4.4, §5 (puntos 4 y 5), §6, §8, §9, §11 y §12.
- **Plan:** [`docs/superpowers/plans/2026-11-03-b5-pagos.md`](../superpowers/plans/2026-11-03-b5-pagos.md) (Rulings B-34 a B-58).

## Contexto

B5 cobra los pedidos que crea B4. El contrato del front (`../frontend/docs/api/openapi.yaml`) y su
mock fijan cinco operaciones y cómo las usa la tienda:

- **Checkout Pro:** `POST /orders/{number}/payments/mercadopago/preference` devuelve un `initPoint`
  y la tienda manda al comprador ahí. Mercado Pago lo devuelve a
  `/checkout/resultado?pedido=<número>`, y esa pantalla consulta el pedido cada 5 segundos hasta
  ver el resultado.
- **Tarjeta dentro de la tienda:** el navegador tokeniza la tarjeta con los Secure Fields de
  Mercado Pago y manda el token a `POST …/mercadopago/card`. La tienda solo lee `challenge`: si
  viene, abre la verificación 3-D Secure del banco en un `iframe`. Si no, va al resultado.
- **Cuotas** (`POST …/installments`), **cancelar el pago en curso** (`POST /orders/{number}/cancel-payment`)
  y el **webhook** (`POST /webhooks/mercadopago`, 200 o 401).
- Las cuatro rutas de pago solo aceptan el `X-Order-Token` del pedido. Preferencia y tarjeta
  llevan `Idempotency-Key`, y la tienda reintenta con la misma clave ante un 5xx o un error de red.

Lo que impone Mercado Pago (investigación del 2026-11-03):

- El resultado de un pago llega **asincrónico y repetido**. Las notificaciones se reintentan
  durante días, pueden llegar desordenadas y se firman con `x-signature`, un HMAC-SHA256 con la
  clave secreta de la aplicación. Mercado Pago espera la respuesta 22 segundos como mucho.
- Un pago con tarjeta responde enseguida (`approved`, `rejected`, `in_process` o
  `pending_challenge` para el 3-D Secure). Un Checkout Pro no: el pago existe recién cuando el
  comprador termina en Mercado Pago.
- Los pagos hechos con credenciales de prueba **pueden no mandar notificaciones**. El panel tiene
  un simulador de notificaciones.
- `X-Idempotency-Key` evita cobros repetidos del lado de Mercado Pago. El SDK `mercadopago`
  3.6.1 cubre preferencias, pagos y devoluciones, pero no las cuotas.

Y lo que el negocio no negocia: **nunca dos cobros válidos por un pedido**, el pedido pasa a pagado
**solo** cuando el back confirma el pago, y el stock reservado en B4 se confirma una sola vez.
Todo eso había que probarlo **sin credenciales** de Mercado Pago, porque todavía no hay.

## Decisión

1. **La pasarela vive detrás de un puerto, con un simulador del mismo tamaño:**
   - `PaymentGatewayPort` (en `application`) tiene `createPreference`, `expirePreference`,
     `validateCardCharge`, `createCardPayment`, `getPayment`, `cancelPayment`, `refundPayment` y
     `getInstallments`.
   - `MercadoPagoGateway` usa el SDK 3.6.1 (`Preference`, `Payment`, `PaymentRefund`, con
     `timeout` de 10 s) y `fetch` para `GET /v1/payment_methods/installments`. Es el único lugar
     que importa `mercadopago`, y traduce sus errores: los de token pasan a 422 y el resto a 502
     `payment_gateway_error`.
   - `SimulatedGateway` responde por titular, con los mismos `APRO`, `CONT`, `OTHE`, `FUND`,
     `SECU`, `EXPI`, `CALL` y `3DS` que el mock del front. Las cuotas salen de la tabla de ajustes.
     Sus páginas HTML (checkout con Aprobar, Dejar pendiente y Rechazar, y el desafío 3DS) las
     sirve el propio back en `/api/v1/__simulated/mercadopago/*`.
   - `MP_MODE` elige el adaptador (`simulated` por defecto). En `production` tiene que ser `live`,
     con `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y `PUBLIC_API_ORIGIN`. Sin eso, la API no arranca.
     Las rutas del simulador dan 404 fuera de `simulated` o con `NODE_ENV=production`, y no
     aparecen en Swagger.
2. **Checkout Pro por preferencias y Checkout API por `/v1/payments`** (Ruling B-34). La API
   Orders queda como migración futura detrás del mismo puerto (ver "Alternativas").
3. **Un intento por fila, uno solo activo:**
   - `payments` guarda cada intento: método, estado, `status_detail`, ids de Mercado Pago,
     `init_point`, `challenge_url`, cuotas, últimos 4 dígitos y montos aprobado y devuelto.
   - El índice único parcial `(order_id) WHERE is_active` asegura un solo intento activo por pedido
     (`none`, `pending` o `action_required`). `idempotency_key` y `(provider, provider_payment_id)`
     también son únicos.
   - Crear un intento nuevo o llamar a `cancel-payment` cancela el anterior en la misma
     transacción, y después lo cancela en Mercado Pago como mejor esfuerzo (pago `pending` o
     preferencia vencida a mano).
   - `refunds` lleva su propia clave idempotente, y `webhook_events` es único por
     `(provider, event_id)`.
4. **`orders.payment_status` se escribe en la misma transacción que el intento** (Ruling B-45,
   opción b de la revisión de la ola 2-3). El repositorio de pagos actualiza esa sola columna con el
   mismo `tx`, y solo si el intento es el vigente (estaba activo, o el pedido no tiene otro activo).
   Es una **excepción acotada al ADR 0001**: un módulo escribe una columna de otro. Se acepta
   porque, con dos transacciones, una caída en el medio dejaba el intento `rejected` y el pedido
   `pending`, y un pedido así no vence nunca. El resto de las escrituras sobre pedidos (pagar,
   devolver) siguen en `orders`, detrás de `OrderPaymentsPort`. `Order.payment` se lee de
   `payments` (lectura cruzada, permitida por el ADR 0001).
5. **Una sola máquina de estados: `ApplyProviderPaymentCommand`.** Todo estado que llega de la
   pasarela pasa por ahí: la respuesta inmediata de la tarjeta, el webhook, el simulador o la
   conciliación.
   - Traduce el estado de Mercado Pago al nuestro: `approved`, `pending`/`in_process`/`authorized`,
     `pending_challenge` → `action_required`, `rejected`, `cancelled`, `refunded`,
     `in_mediation` → `in_dispute` y `charged_back`.
   - Un estado final (`approved`, `refunded`, `partially_refunded`, `in_dispute`,
     `charged_back`) nunca vuelve a `pending` ni a `rejected`.
   - **Pagar** es un `UPDATE orders … WHERE status = 'pending_payment'`. En la misma transacción,
     las reservas pasan a `committed`, `inventory` baja `on_hand` y `reserved` (ordenado por
     producto), se agregan el historial `paid` (actor `provider`) y los eventos `payment.approved`
     y `order.paid`, y se borra la caché del catálogo.
   - El intento se lee con `SELECT … FOR UPDATE`. Así, la respuesta de la tarjeta y el webhook del
     mismo pago aplicados en paralelo confirman el stock y escriben los eventos **una vez**.
   - Un `approved` repetido retoma el efecto pendiente si el anterior se cortó entre guardar el
     intento y pagar el pedido (`resumeApproved`).
6. **Respuesta inmediata más webhook idempotente** (Rulings B-37, B-38 y B-40):
   - `POST …/card` aplica en la misma llamada lo que respondió la pasarela: un `APRO` deja el
     pedido pagado al instante, como en el mock. El webhook es la conciliación de la tarjeta y el
     único camino de Checkout Pro.
   - El webhook valida la firma con un HMAC propio en tiempo constante, con `data.id` en
     minúsculas y los segmentos ausentes omitidos. Sin secreto configurado responde 401 siempre.
   - Después registra el evento una vez (deduplica por el `id` del cuerpo o por `x-request-id`),
     lo encola en `payment-webhooks` (`jobId` = id del evento, 5 intentos) y responde 200. Si
     Redis no acepta el job, lo procesa en línea antes de responder.
   - Un evento repetido que todavía no se procesó se vuelve a encolar. El barrido retoma los
     eventos sin procesar de las últimas 6 horas.
   - Un aviso con formato IPN responde 200 sin hacer nada. El webhook nunca responde 404, 409 ni 422.
7. **Claves idempotentes de punta a punta:**
   - La `Idempotency-Key` de la tienda (UUID v4) es el `idempotency_key` del intento y la
     `X-Idempotency-Key` que va a Mercado Pago. Un reintento de la tienda nunca crea un segundo
     cobro.
   - Si la pasarela falla, el intento se cancela y su clave queda "suelta"
     (`<clave>:released:<id>`, que nunca es un UUID): el reintento con la misma clave crea un
     intento limpio y no choca con el único.
   - Antes de cancelar nada, el simulador valida el token y las cuotas
     (`validateCardCharge`). Con Mercado Pago real, eso recién se sabe al cobrar.
   - Cancelar un pago y vencer una preferencia salen con un UUID propio. El SDK 3.6.1 guarda en el
     `MercadoPagoConfig` compartido la última clave usada, y esos `PUT` la heredaban.
8. **Devolución automática de duplicados y tardíos** (Ruling B-41):
   - Un `approved` para un pedido ya pagado se devuelve entero, con motivo `duplicate_payment`.
   - Un `approved` para un pedido `expired` o `cancelled` también, con motivo `late_approval`.
   - La fila de `refunds` se crea `pending`, con su propia clave, **antes** de llamar a Mercado
     Pago. Si la llamada falla, queda `failed` con `last_error` y no se relanza: B6 la muestra
     como alerta "Devolvelo desde Mercado Pago".
   - Un pedido pagado no cambia de estado por devolver un duplicado.
9. **Conciliación y plazos** (Rulings B-42 y B-43). El barrido de 60 s corre, en orden:
   - **Vencer** (`expireDue`). Un pago `pending` o `action_required` no vence.
   - **Conciliar** los pedidos `pending_payment` con pago en curso, 10 minutos después de
     `reserved_until`: consulta el pago y lo aplica. Si sigue pendiente 48 horas después de
     `reserved_until`, lo cancela en Mercado Pago y el pedido vence en la misma pasada. Un
     Checkout Pro dividido que quedó con aprobados por menos del total también se devuelve y vence
     a las 48 h.
   - **Retomar webhooks** sin procesar.

   Al vencer un pedido, el consumidor de `order.expired` (un `@Processor` del outbox en `payments`)
   cancela el intento activo y vence la preferencia en Mercado Pago. Una preferencia sin pagar no
   frena el vencimiento de los 30 minutos.

## Consecuencias

- **Todo se prueba sin credenciales:** los unitarios, los E2E con Postgres y Redis reales y la
  prueba en vivo con la tienda compilada corren contra `SimulatedGateway`. El sandbox real queda
  en `test/e2e/mercadopago.sandbox.e2e-spec.ts`, que se omite sin `MP_ACCESS_TOKEN`, y en la guía
  del README.
- **Nunca dos cobros válidos:** un segundo pago sobre un pedido pagado recibe
  `409 order_not_payable`. Si igual entra uno aprobado (Checkout Pro en otra pestaña, una
  notificación tardía), se devuelve solo, una vez, y queda auditado en `refunds`.
- **El stock se confirma una vez,** aunque la tarjeta y el webhook lleguen juntos. En la prueba en
  vivo, el Mate Imperial Premium bajó `on_hand` de 8 a 7 al pagar, con `reserved` en 0.
- **Un pedido con pago en curso puede vivir más de 30 minutos** (hasta 48 h si Mercado Pago lo
  deja pendiente), con el stock reservado. Es el precio de no vender dos veces lo que alguien
  está pagando.
- **Los pagos de prueba pueden no notificar.** La conciliación cubre un pago que ya tiene id en
  Mercado Pago (tarjeta `pending`/`action_required`, o un Checkout Pro que avisó `pending`): lo
  consulta a los 10 minutos de `reserved_until`.
  - **No cubre un Checkout Pro del que nunca llegó ningún aviso:** el intento sigue en `none`, sin
    id de pago que consultar. El pedido vence a los 30 minutos, y si la notificación llega
    después, se devuelve como tardío.
  - Buscar el pago por `external_reference` (`GET /v1/payments/search`) en la conciliación queda
    pendiente (ver la bitácora). En el sandbox se suple con el simulador de notificaciones del
    panel.
- **La excepción del ADR 0001** (pagos escribe `orders.payment_status`) está escrita en el
  repositorio y en `OrderPaymentsPort`. Si aparece otra escritura así, conviene una unidad de
  trabajo compartida.
- **3-D Secure en la tienda local:** el `challenge.url` del simulador es `http://localhost:3001/…`.
  La tienda solo guarda URLs `https:` o rutas propias, y su CSP solo enmarca `https:`, así que en
  la prueba en vivo el desafío simulado se resolvió en su propia pestaña. Con Mercado Pago real la
  URL es `https` y el `iframe` carga. Lo que falta revisar con el sandbox es que Mercado Pago pide
  un `POST` del `creq` y el contrato solo lleva la URL.
- **Más piezas que vigilar:** cola `payment-webhooks`, un segundo worker del outbox y tres pasos
  en el barrido. Todos cierran forzados si Redis no responde, como el de B4.

## Alternativas descartadas

- **API Orders de Mercado Pago (la recomendada para integraciones nuevas):**
  - El contrato y la tienda están armados sobre los conceptos de Payments: `statusDetail`,
    `challenge.url`, cuotas propias, tokens de Secure Fields y preferencias de Checkout Pro.
  - El SDK 3.6.1, las tarjetas de prueba y la documentación de 3DS están probados para Payments.
  - Migrar es cambiar el adaptador detrás de `PaymentGatewayPort`, sin tocar la máquina de estados
    ni el contrato.
- **Solo el webhook, sin aplicar la respuesta de la tarjeta:** la tienda va al resultado apenas
  responde el back, y el mock deja el pedido pagado con un `APRO` en la misma llamada. Esperar la
  notificación dejaría "Estamos esperando la confirmación" en cada compra con tarjeta, y en el
  sandbox podría no llegar nunca.
- **Confiar en la vuelta del comprador (`back_urls` con `status=approved`):** esos parámetros los
  puede escribir cualquiera en la barra del navegador. El pedido solo se paga con un estado que el
  back leyó de Mercado Pago.
- **Procesar el webhook en la misma llamada, sin cola:** una consulta lenta a Mercado Pago o un
  bloqueo de Postgres pasan los 22 s y Mercado Pago reintenta lo que ya estaba en curso. La cola da
  reintentos con backoff, y el procesado en línea queda solo para cuando Redis no responde.
- **El `WebhookSignatureValidator` del SDK:** no pasa `data.id` a minúsculas, aunque la
  documentación lo pide. Son veinte líneas con `node:crypto` y comparación en tiempo constante, y
  se prueban con los casos de la documentación.
- **El estado del pago como columnas de `orders`, sin tabla de intentos:** se pierde el historial
  de intentos y no hay dónde guardar un segundo pago aprobado para devolverlo. "Un intento activo"
  tampoco quedaría garantizado por la base.
- **Devolver a mano los duplicados (solo una alerta):** el comprador ve dos cobros hasta que alguien
  mire el panel. La devolución automática más la alerta de las que fallan cubre los dos casos.
- **Una unidad de trabajo compartida entre `orders` y `payments`** (en lugar de la excepción de
  `payment_status`): agrega una abstracción de transacciones para una sola columna.
- **Pasarela de terceros o guardar tarjetas:** el comprador argentino espera Mercado Pago, y los
  datos de tarjeta nunca pasan por el back (solo el token de un uso). `payment_methods` (tarjetas
  guardadas) queda para cuando haga falta.
