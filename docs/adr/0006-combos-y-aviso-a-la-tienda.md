# ADR 0006 · Combos y aviso a la tienda

- **Estado:** aceptada (aplicada en B5c, 2026-11-03).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §3.2 (`storefront-sync`) y §6 (colas).
- **Plan:** [`docs/superpowers/plans/2026-11-03-b5c-combos.md`](../superpowers/plans/2026-11-03-b5c-combos.md) (Rulings B-59 a B-68).

## Contexto

El front sumó los combos en la rama `feat/inicio-combos`, ya mergeada en su `main` local
(`063c091`).
Un combo son 2 o 3 productos fijos, de grupos distintos (mate, bombilla, yerba), con un precio
final menor que la suma de las piezas. El contrato (`docs/api/openapi.yaml` y
`validation-cases.json` del front) y su mock fijan:

- **La tienda** muestra en el inicio los combos publicados (`GET /combos`) y los vende como una
  línea más del carrito (`type: 'combo'`), con el cuero y la virola del mate si lleva uno.
- **El dashboard** los crea, edita, borra y ordena (`/admin/combos`, `PUT /admin/combos/order`).
- **Lo derivado** (suma de las piezas, ahorro, agotado, cantidad máxima, si se puede comprar) sale
  del stock y de los precios vigentes de cada pieza, en cada lectura.
- **"Guardar y verlo al instante":** la tienda cachea el inicio por horas
  (`cacheLife('hours')`, etiquetas `combos` y `products`) y solo se regenera antes si alguien le
  pide `POST /api/revalidate` con su `REVALIDATE_SECRET`. Sin aviso, un cambio del dashboard
  tardaría horas en verse.
- El outbox de B1 ya guardaba los eventos en la misma transacción que la escritura, pero tenía un
  solo consumidor, en `payments` (`OutboxEventsProcessor`, que descartaba todo lo que no fuera
  `order.expired`).

## Decisión

1. **Los combos son de `catalog`**, con sus propias tablas y su repositorio:
   - `combos` (`price_ars` entre 1 y 99.999.999, `position` ≥ 1, `status` `draft | published`) y
     `combo_items` (PK `(combo_id, position)`, único `(combo_id, product_id)`, posición 1 a 3).
     El borrado de un combo arrastra sus piezas; un producto que es pieza de algún combo no se
     puede borrar (`RESTRICT`). Los CHECK están escritos a mano en la migración `b5c_combos`.
   - `ComboRepository` (`PrismaComboRepository`) lee las piezas en cualquier estado, con el mismo
     `toProduct` del catálogo, y la vista `Combo` es la del mock campo por campo.
   - Los casos de uso se cablean con `useFactory`, como el resto del catálogo. Las reglas del
     dashboard (cuerpo, piezas publicadas y con precio, grupos distintos, precio menor que la suma)
     son las del mock, en el mismo orden.
2. **Sin caché de Redis para combos.** `GET /combos` y `GET /admin/combos` leen Postgres siempre.
   Lo derivado depende del stock, que cambia con cada pedido: cachearlo obligaría a que `orders`
   y `payments` también borren esa clave. La tienda ya cachea el inicio, así que el back recibe la
   lectura casi solo cuando la tienda se regenera.
3. **La línea de pedido es una copia, sin `combo_id`.** `order_items` guarda `line_type = 'combo'`,
   el nombre, el precio y el `detail` del momento, y `order_item_components` guarda cada pieza con
   su `position` (el orden del combo; los kits viejos se rellenaron 1, 2, 3 por rol). Borrar o
   editar un combo después no cambia los pedidos que ya lo tienen. Al cotizar y al crear el
   pedido, `orders` lee los combos sin caché desde su adaptador del catálogo (la lectura cruzada
   del ADR 0001). Un combo que ya no se puede vender (borrado, en borrador, con una pieza archivada
   o sin precio, o con piezas que dejaron de ser de grupos distintos) da `unavailable` en la
   cotización y `409 stock_changed` en el pedido, nunca un 500. El stock de cada pieza se comparte
   con las otras líneas, y la reserva suma cada pieza.
4. **Un despachador compartido del outbox.** `OutboxHandlerRegistry` y `OutboxDispatcherProcessor`
   viven en `src/shared/infrastructure/outbox/`. El despachador es el único consumidor de la cola
   `outbox` y le pasa cada evento a los handlers registrados para su tipo. Los handlers se
   registran **en su constructor**: Nest crea todos los providers antes de arrancar los workers,
   así que un job pendiente desde antes de un reinicio nunca encuentra el registro a medias.
   `payments` pasó a `OrderExpiredOutboxHandler`, con el mismo comportamiento (sus E2E pasan sin
   tocarlos).
5. **Cada guardado del dashboard le avisa a la tienda por el outbox.**
   - Alta, edición, borrado y orden agregan `combo.changed` (`{ comboId, change }`) en la misma
     transacción que la escritura. Un 4xx no deja ningún evento.
   - El módulo `storefront-sync` traduce el evento a etiquetas (`combo.changed` → `combos`, con el
     mismo patrón de etiquetas de la tienda) y encola `storefront-revalidate` con
     `jobId` = id del evento (8 intentos, backoff exponencial desde 1 s: unos 2 minutos).
   - El procesador hace `POST ${STORE_ORIGIN}/api/revalidate` con `x-revalidate-secret` y
     `{"tags":["combos"]}` (timeout 5 s). 2xx → listo; 4xx (salvo 408 y 429) → falla sin
     reintentos (un secreto o una etiqueta mal no se arreglan reintentando); 5xx, 408, 429, red
     o timeout → reintenta. Las redirecciones no se siguen: un 3xx cuenta como rechazo.
   - `STORE_REVALIDATE_SECRET` es el mismo `REVALIDATE_SECRET` de la tienda (32 caracteres o más).
     Es opcional en desarrollo y en test: sin él no se encola nada y el back avisa una vez al
     arrancar. En `production` es obligatorio. Nunca se loguea.

## Consecuencias

- **Falla abierta por construcción:** la respuesta del dashboard solo depende de Postgres. Con
  Redis caído el evento espera en `outbox_events`; con la tienda caída, reintenta la cola; si se
  agotan los reintentos, la tienda igual se pone al día sola cuando vence su caché.
- **"Al instante" es de 0 a unos 2 s del relay más el POST.** En la prueba en vivo, la primera
  recarga del inicio, a los 1,7 s de guardar, ya mostró el precio nuevo; después de un cambio de
  orden, la de los 0,5 s todavía mostró el viejo y la de los 2,2 s el nuevo (ver la bitácora, B5c).
  La tienda sirve lo anterior mientras se regenera, así que a veces hace falta una recarga más.
- **Cada lectura de combos va a Postgres** (`GET /combos`, `GET /admin/combos` y la cotización de
  un carrito con combos). Es una consulta con `include` de las piezas, por posición. Si algún día
  pesa, una caché tendría que borrarse también con cada cambio de stock.
- **Las posiciones no toman un lock.** Dos altas simultáneas pueden quedar con la misma `position`
  (la lista no tiene único: se ordena por `position` y después por `created_at`, y el próximo orden
  o borrado lo corrige), y un orden simultáneo con un borrado ignora el id que ya no está. Con un
  solo admin es aceptable.
- **Un evento con varios handlers se reintenta entero** si uno falla. Por eso el handler de la
  tienda solo encola (falla solo si Redis cae) y el HTTP va en su propia cola.
- **El patrón de etiquetas está copiado** de la tienda (`REVALIDATE_TAG_PATTERN`): si la tienda
  suma o cambia etiquetas, hay que actualizar `STOREFRONT_TAG_PATTERN`.
- **B6 y B7** reusan el despachador: avisar `products` con los cambios de stock y consumir
  `order.paid` para los mails son handlers nuevos, sin tocar `payments`.

## Alternativas descartadas

- **Cachear `GET /combos` en Redis** (`catalog:combos`, 60 s): acopla `orders` y `payments` a una
  clave más y, si el borrado llega después de que la tienda vuelva a pedir, la tienda se regenera
  con el dato viejo.
- **Guardar `combo_id` en la línea del pedido:** ataría los pedidos al combo vivo (un borrado
  tendría que esperar o romper la FK) y el contrato no lo pide: la línea muestra lo que se compró.
- **Llamar a la tienda dentro de la petición del dashboard:** la respuesta dependería de la tienda
  y un error dejaría el combo guardado sin aviso, sin reintentos.
- **POST directo desde el handler del outbox, sin cola propia:** alcanza con un solo handler por
  tipo, pero un reintento de la tienda reintentaría también los otros handlers del mismo evento.
- **Un segundo consumidor de la cola `outbox`:** dos workers sobre la misma cola se reparten los
  jobs; cada uno descartaría los eventos del otro.
