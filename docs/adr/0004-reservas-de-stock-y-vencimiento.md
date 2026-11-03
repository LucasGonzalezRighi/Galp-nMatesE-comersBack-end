# ADR 0004 · Reservas de stock y vencimiento de pedidos

- **Estado:** aceptada (aplicada en B4, 2026-11-03).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §3.2, §4.2, §4.3, §5 y §6.
- **Plan:** [`docs/superpowers/plans/2026-11-02-b4-pedidos.md`](../superpowers/plans/2026-11-02-b4-pedidos.md) (Rulings B-16 a B-25 y B-28).

## Contexto

B4 crea los pedidos. El contrato del front (`../frontend/docs/api/openapi.yaml`) y su mock fijan
cómo se comportan:

- `POST /orders` crea el pedido en `pending_payment` y **reserva el stock 30 minutos**
  (`reservedUntil`). La tienda lo llama al elegir el medio de pago, con `Idempotency-Key`. El pago
  llega en B5, sobre este mismo pedido.
- Si nadie paga, el pedido vence y el stock vuelve. La tienda consulta `GET /orders/{number}` y
  espera `status: 'expired'` **apenas** pasa `reservedUntil`: el mock vence "al leer", y la pantalla
  "El pedido venció" depende de eso.
- Toda la tienda llega desde un solo servidor (Next), y dos personas pueden querer las últimas
  unidades al mismo tiempo. **No se puede vender lo que no hay** (Review Focus 2: con 5 unidades,
  10 pedidos simultáneos dejan 5 pedidos y 5 `409 stock_changed`).
- El mismo producto se puede pedir suelto y como pieza de un kit: las dos líneas comparten el
  stock.
- El catálogo muestra la disponibilidad (`maxQuantity`, `isSoldOut`) en cada lectura, y la tienda
  concilia el carrito con `GET /products?ids=`.
- Un pedido se lee con su `X-Order-Token` (invitados) o con la sesión del dueño. Un invitado no
  tiene cuenta, y alguien con cuenta puede comprar sin iniciar sesión.

## Decisión

1. **La reserva vive en dos lugares, el contador y las filas:**
   - `inventory.reserved` es un contador por producto. Lo disponible es `on_hand − reserved`, en
     una sola fila, y el catálogo lo lee sin agregar nada (`inventory_reserved_check` impide que
     `reserved` supere `on_hand`).
   - `stock_reservations` guarda una fila por producto y pedido (`active`, `committed` o
     `released`, con `expires_at = reserved_until` y único `(order_id, product_id)`). Con las filas
     se sabe qué liberar de cada pedido, B5 las pasa a `committed` al cobrar y queda la auditoría.
2. **Se reserva con un `UPDATE` condicional dentro de la transacción del pedido:**

   ```sql
   UPDATE inventory SET reserved = reserved + $q, version = version + 1
   WHERE product_id = $id AND on_hand - reserved >= $q
   ```

   - Las cantidades se suman por producto (suelto + piezas de kit) y los productos se recorren
     ordenados por id, para que dos transacciones nunca tomen los mismos bloqueos en orden inverso
     (deadlock). Liberar también va en ese orden.
   - Si un producto no alcanza, la transacción sigue con los demás para juntar **todos** los
     faltantes con su disponible real, y después se deshace: `409 stock_changed` con un
     `ChangeNotice` por producto (`Quedan N unidades de X.`, `X se agotó.`).
   - En la misma transacción van el pedido, sus ítems, las piezas de los kits, el historial, las
     filas de reserva y el evento `order.created` del outbox. El número (`nextval('order_number_seq')`)
     se pide recién cuando alcanzó el stock, porque una secuencia no vuelve atrás con el rollback.
   - Al confirmar, se borran de la caché `catalog:products:slug:<slug>` y
     `catalog:products:group:<group>` de cada producto. Las listas con `ids` ya no se cachean.

3. **`version` no se usa para bloquear.** Se incrementa en cada cambio, pero la exclusión la da el
   bloqueo de fila del `UPDATE` condicional (ver "Alternativas").
4. **El vencimiento tiene tres caminos, idénticos e idempotentes.** Todos terminan en
   `ExpireOrdersCommand` → `OrderRepository.expire(orderId, now)`:

   ```sql
   UPDATE orders SET status = 'expired'
   WHERE id = $1 AND status = 'pending_payment'
     AND payment_status IN ('none', 'rejected', 'cancelled') AND reserved_until <= $now
   ```

   - Solo quien gana ese `UPDATE` (`updateManyAndReturn`) libera las reservas (`active` →
     `released`), resta `inventory.reserved`, suma al historial `expired` con fecha
     `reserved_until` y actor `system`, y deja el evento `order.expired`. Todo en la misma
     transacción. Los demás caminos que lleguen después no encuentran nada que vencer.
   - **Job diferido:** `order.expire` en la cola `order-expiration` de BullMQ, con
     `jobId = orderId`, `delay = reserved_until − now`, 5 intentos y backoff exponencial. La cola
     usa `enableOfflineQueue: false`, y si no se puede encolar se avisa con un `warn` sin romper
     la creación del pedido.
   - **Barrido:** `OrderExpirationSweep` cada 60 s, `expireDue(now, 50)` (apagado con
     `NODE_ENV=test`, como el relay del outbox).
   - **Al leer:** `GET /orders/{number}` y `GET /me/orders/{number}` vencen ese pedido antes de
     responder; `POST /cart/quote`, `POST /orders` y `GET /me/orders` corren antes
     `expireDue(now, 50)`.
   - El repositorio compara con el `now` del reloj de la app, nunca con el `now()` de Postgres
     (los tests usan un reloj fijo).
   - Un pago `pending` o `action_required` no vence: lo decide B5.

5. **Dueño del pedido y token** (Rulings B-17, B-20 y B-21):
   - `orderToken` = `ot_` + 32 bytes aleatorios en hex. La base guarda solo su SHA-256
     (`orders.access_token_hash`, único). No vence aparte del pedido, se entrega siempre (con
     sesión o sin ella) y se repite en el replay idempotente, porque va en el 201 guardado.
   - `GET /orders/{number}` acepta primero el token y, si no, la sesión del cliente dueño.
     Inexistente, token ajeno o sesión ajena dan el mismo `404 not_found`.
   - Con sesión de cliente, el pedido es de esa cuenta aunque el email escrito sea otro.
   - Sin sesión, se busca el cliente por email: si no existe se crea un invitado; si es invitado
     se vincula y se actualizan nombre y teléfono; si **tiene cuenta**, el pedido queda **sin**
     dueño y solo se lee con el token. Así nadie mete pedidos en la cuenta de otro sabiendo su
     email.
   - Al registrarse con el email de un invitado, la cuenta adopta ese cliente y sus pedidos (B3,
     `attachUser`) sin verificar el email. Se mantiene: es lo que promete la tienda y el contrato
     no pide verificación (ver "Consecuencias").

## Consecuencias

- **Sin sobreventa:** Postgres serializa los `UPDATE` sobre la misma fila de `inventory`, y cada
  uno vuelve a evaluar la condición con el valor confirmado. Lo cubren los tests de los tres
  niveles: dominio con puertos en memoria, repositorio contra Postgres real y HTTP (10 pedidos
  simultáneos sobre 5 unidades → 5 y 5).
- **El stock vuelve aunque falle un camino:** sin Redis no hay job, pero el barrido y la lectura
  vencen igual. Un pedido abandonado que nadie vuelve a mirar lo vence el job a los 30 minutos o,
  si el job se perdió, el barrido en menos de un minuto. En la prueba en vivo, el barrido liberó en
  unos 40 s, sin ninguna lectura, dos pedidos vencidos a mano.
- **Liberar una sola vez:** correr el job, el barrido y la lectura sobre el mismo pedido libera una
  sola vez (test con tres `expire` en paralelo).
- **La lectura puede escribir.** `GET /orders/{number}` y `GET /me/orders*` abren una transacción
  cuando hay algo que vencer. Es barato (el pre-chequeo no abre transacción si el pedido no es
  vencible), pero un error de esa limpieza le da 500 a la lectura.
- **La fecha del vencimiento es `reserved_until`, no la del camino que lo vio.** El historial dice
  cuándo venció de verdad. Para vencer un pedido a mano alcanza con mover `reserved_until` al
  pasado (README, "Pedidos y stock").
- **El token se guarda en claro en un lugar:** el 201 completo queda en
  `idempotency_keys.response_body` mientras vive la clave (24 h), para que el replay devuelva el
  mismo token. Las claves vencidas todavía no se purgan (B8).
- **`version` queda para el admin:** B6 puede usarlo para detectar ediciones concurrentes de
  `on_hand`. Si el admin baja `on_hand` por debajo de `reserved`, el CHECK lo rechaza (el seed ya
  no lo intenta: deja la fila como está y avisa).
- **Adopción sin verificación:** quien registre una cuenta con el email de un invitado ve sus
  pedidos. Es el mismo riesgo que ya anotó el ADR 0003; la verificación de email llegaría con el
  proveedor de mail (B7) si se decide.
- **Doble envío simultáneo:** con la misma `Idempotency-Key`, el segundo pedido que llega mientras
  el primero corre recibe `409 idempotency_in_progress` (interceptor de B1, sin cambios); un
  reintento posterior recibe el 201 guardado con `Idempotent-Replayed: true`. Se crea un solo
  pedido. Que los dos reciban 201 exigiría que el interceptor espere al primero (B8).

## Alternativas descartadas

- **Bloqueo pesimista (`SELECT … FOR UPDATE` y después `UPDATE`):**
  - Hace dos viajes por producto y tiene el bloqueo tomado más tiempo, sin dar nada que el `UPDATE`
    condicional no dé: ese `UPDATE` también toma el bloqueo de la fila, y la condición se evalúa
    sobre el valor confirmado.
  - Igual necesita ordenar los productos para no caer en deadlocks.
- **Bloqueo optimista con `version` (leer, comparar y escribir con reintentos):**
  - Con muchos compradores sobre las últimas unidades, la mayoría falla por versión aunque el stock
    alcance, y hay que reintentar en un bucle.
  - El `UPDATE` condicional solo falla cuando de verdad no hay stock.
- **Solo filas (`on_hand − SUM(reservas activas)`):** el catálogo tendría que agregar en cada
  lectura, y la reserva necesitaría bloquear algo igual (o `SERIALIZABLE`) para no sobrevender.
- **Descontar `on_hand` al crear el pedido:** mezcla el stock físico con lo prometido. Las
  ediciones del admin chocarían con las reservas, y devolver el stock dependería de no perder nunca
  una liberación.
- **Solo el job diferido:**
  - Si Redis cae o el worker se demora, el stock queda bloqueado y la tienda muestra "No
    completaste el pago" después de `reservedUntil`. El E2E del front espera "El pedido venció" en
    la primera lectura.
  - Un job perdido nunca libera.
- **Solo el vencimiento al leer (como el mock):** los carritos abandonados son el caso común, y un
  pedido que nadie vuelve a leer dejaría el stock reservado hasta que alguien cotice o cree otro
  pedido. Por eso lo acompañan el job y el barrido.
