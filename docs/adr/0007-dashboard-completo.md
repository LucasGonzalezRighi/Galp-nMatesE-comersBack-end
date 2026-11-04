# ADR 0007 · Dashboard completo

- **Estado:** aceptada (aplicada en B6, 2026-11-04).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §3.2 (módulos), §5 (caché) y §6 (colas).
- **Plan:** [`docs/superpowers/plans/2026-11-04-b6-admin.md`](../superpowers/plans/2026-11-04-b6-admin.md) (Rulings B-69 a B-85).

## Contexto

Hasta B5c el back tenía 47 de las 83 operaciones del contrato del front. Las 36 que faltaban eran
casi todas del dashboard: productos, líneas, firma de fotos, pedidos, reseñas, mensajes,
contenidos, ajustes y el resumen, y además tres formularios públicos de la tienda (contacto,
arrepentimiento y reseña nueva). En el medio, el front cambió el contrato en la ronda "ajustes de
la tienda" (`feat/ajustes-tienda`, `6a5cd30`; hoy en el `main` del front, `24b62ab`): cada producto
trae sus cueros (`leathers`, de 0 a 4, solo los mates), la virola desaparece y los relacionados
pasan a ser hasta 30.

Lo que fija el pedido de Lucas, y no el contrato, es que **lo que se guarda en el dashboard se vea
en la tienda al instante**: un mate sin stock no se tiene que poder agregar al carrito, y los
cueros de la ficha son los que marca el dashboard. La tienda cachea por horas
(`cacheLife('hours')`) y solo se regenera antes si alguien le pide `POST /api/revalidate`; el back
cachea el catálogo en Redis por 60 s.

## Decisión

1. **Un solo aviso genérico a la tienda: `storefront.stale`.** `storefrontStaleEvent(reason,
tags)` (`src/shared/domain/storefront-tags.ts`) arma un evento `{ reason, tags }` que cada
   escritura del dashboard (y cada cambio de stock de los pedidos) agrega al outbox **en la misma
   transacción**. `storefront-sync` lo traduce 1 a 1 a etiquetas y reusa la cola
   `storefront-revalidate` de B5c (`combo.changed` sigue igual). Las etiquetas, por escritura:
   producto → `products`, `product:{slug}` (y el slug anterior si cambió), `categories`, `combos`;
   línea → `categories`, `products`; contenido → `content:{key}` (`product-tabs` suma `products`);
   ajustes → `settings`, `products`, `combos`; moderación → `reviews:featured`, `reviews:{slug}`,
   `product:{slug}`, `products`; pedido creado, pagado, vencido o cancelado → `products`,
   `combos`. El helper rechaza una etiqueta que no cumpla `STOREFRONT_TAG_PATTERN` (el mismo
   `REVALIDATE_TAG_PATTERN` de la tienda), y un 4xx no deja evento.
2. **Caché del catálogo con versión.** Las claves del catálogo son `catalog:v{n}:…`; `n` se lee de
   `catalog:version` en cada lectura y cada escritura de productos y líneas, y cada moderación,
   hace `INCR` después del commit (`bumpCatalogCacheVersion`). Así no hay que adivinar qué claves
   toca un cambio (un rename toca la ficha vieja, la nueva, el grupo y los listados). Los pedidos
   siguen borrando las claves de los productos que tocan, con la versión leída **después** del
   commit. Las lecturas del dashboard van a Postgres sin caché. `content` y `settings` borran su
   clave después del commit.
3. **El stock del dashboard es el disponible.** `AdminProduct.stock`, `lowStock`, `stock=out` y el
   resumen usan `on_hand − reserved` (sin fila de `inventory`, 0). Guardar escribe
   `on_hand = stock + reserved` en la misma transacción, así el CHECK `inventory_reserved_check`
   nunca salta por una reserva viva.
4. **Fotos por carpeta, sin la Admin API de Cloudinary.** `MEDIA_MODE` `simulated` (por defecto:
   la firma del mock y la nube `galpon-mock`) o `cloudinary` (firma sha1 con las tres
   `CLOUDINARY_*`; obligatorio en `production`). Una foto se acepta si su `publicId` está en la
   carpeta de su uso (`galpon/productos/`, `galpon/lineas/`, `galpon/socios/`, `galpon/sitio/`),
   sin segmentos `.`/`..` (tampoco con `%2e`) ni caracteres de control, o si es la que el recurso
   ya tiene; si no, 422 `unknown_image`. La `url` se arma con la nube y el `publicId`. `media_assets`
   se busca o se crea por `publicId` y el `alt` es por uso (`product_images.alt`,
   `categories.image_alt`).
5. **Cueros por producto.** `products.leathers text[]` con un CHECK de los cuatro valores; solo
   los mates llevan (422 con el mensaje del front). El carrito y el pedido siguen las reglas del
   mock (`options: { leather }` obligatorio solo si el producto, el mate del kit o el del combo
   ofrece cueros). Los pedidos viejos conservan `ferrule` en el JSON y el mapper la ignora. Sin
   ventana de transición: una pestaña vieja de la tienda recibe 422 hasta recargar.
6. **Dos módulos nuevos.** `support` (`contact_messages` con los dos tipos del contrato: contacto y
   arrepentimiento con código `ARR-` + 6 dígitos de una secuencia; la bandeja del dashboard; los
   mails quedan para B7 y hoy se loguea la intención) y `dashboard` (el resumen, con un adaptador
   Prisma de solo lectura que cruza tablas de otros módulos, permitido por el ADR 0001; vence los
   pedidos atrasados antes de leer). Cancelar desde el dashboard es una escritura cruzada acotada
   de `orders` sobre el intento activo de `payments`, la inversa de B-45, escrita en el ADR 0001;
   la pasarela la resuelve un handler de `payments` del evento `order.cancelled`.
7. **El seed no pisa lo del panel.** Los productos se siembran por `sequence` (un rename del
   dashboard vuelve al slug del diseño sin duplicarse, y el slug del panel pasa al historial);
   contenidos, ajustes y envíos solo se crean si faltan.

## Consecuencias

- **Una sola cañería para todo.** Cualquier escritura nueva le avisa a la tienda con una línea
  (`storefrontStaleEvent`) en su transacción; la falla abierta, los reintentos y el secreto son
  los de B5c (ADR 0006).
- **"Al instante" depende de la tienda.** En la prueba en vivo de B6, el título del inicio se vio
  a los 3,5 s del guardado y una reseña aprobada a los 2,3 s. Pero la tienda compilada del front
  (`24b62ab`, Next 16.4.2) responde **500** en `/producto/[slug]` y `/tienda/[linea]` después de
  regenerar las etiquetas `categories` o `settings`, hasta que se reinicia `next start`
  (`NEXT_STATIC_GEN_BAILOUT`). El back las manda porque son del contrato (B-73) y la tienda las
  acepta; el arreglo es del front (detalle en la bitácora, B6).
- **Más eventos en el outbox.** Cada pedido creado, pagado, vencido o cancelado suma un
  `storefront.stale`; con la concurrencia 1 del despachador, un `order.expired` lento demora los
  avisos.
- **`catalog:version` no tiene TTL.** Si Redis lo desaloja vuelve a 0 y pueden reaparecer claves
  `v0` viejas hasta 60 s. Con Redis caído, `INCR` falla abierta y la versión no cambia (las claves
  igual vencen en 60 s).
- **Último guardado gana** en contenidos y ajustes (el contrato no trae `expectedUpdatedAt` ahí);
  los productos sí lo traen y dan 409 `product_changed`.
- **El IVA con más de 2 decimales se redondea** (mitad para arriba) y la respuesta devuelve lo
  guardado.
- **Sin `audit_logs` todavía** (B8): el historial de los pedidos guarda `actor: admin`, y
  contenidos y ajustes guardan `updated_by` y `version`.

## Alternativas descartadas

- **Un evento por recurso** (`product.changed`, `category.changed`…) con el mapeo a etiquetas en
  `storefront-sync`: obligaba a `storefront-sync` a conocer cada módulo (y a leer slugs viejos);
  con `storefront.stale` cada módulo dice qué cambió en sus términos.
- **Borrar claves sueltas del catálogo** en cada escritura: un rename o un cambio de línea toca
  claves que no se conocen sin releer todo; con la versión alcanza un `INCR`.
- **`stock` del dashboard = `on_hand`:** el admin vería unidades que ya están reservadas y un
  `PATCH` con menos que lo reservado rompería el CHECK con un 500.
- **Verificar cada foto contra la Admin API de Cloudinary:** suma latencia y credenciales a cada
  guardado; la carpeta por uso y la firma de la subida alcanzan para que el dashboard no apunte a
  fotos ajenas.
- **Seed que pisa todo:** una nueva corrida borraba lo que Lucas guarda desde el panel.
