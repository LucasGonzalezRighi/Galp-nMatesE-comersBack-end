# Datos del seed

Datos planos del diseño que `prisma/seed.ts` escribe en la base (`npm run db:seed` o `npx prisma db seed`, con la base ya migrada).

- `types.ts`: las formas, a mano.
- `admin.ts`: el admin semilla del panel, **a mano** (el script de abajo no lo genera ni lo pisa).
- `categories.ts`, `products.ts`, `reviews.ts`, `content.ts`, `settings.ts`, `combos.ts`: **generados**, no se editan a mano.

## Admin semilla

`admin.ts` tiene las credenciales del modo demo del front: `admin@galponmates.com.ar` / `galpon-demo-2026`. El seed crea ese usuario (`role` `admin`, `status` `active`, contraseña hasheada con argon2id: 19 MiB, 2 pasadas, 1 hilo) **solo si no existe**; si ya está, no lo toca, así una nueva corrida no pisa la contraseña que se haya cambiado desde el panel. Para volver a la de demo, borrá el usuario y corré el seed de nuevo. Las reseñas y los contenidos sembrados quedan sin cliente ni editor (`reviews.customer_id` y `content_blocks.updated_by` en `null`).

## Regenerar desde las fixtures del front

Cuando cambian las fixtures del mock del front (`frontend/packages/api-client/src/mock/fixtures/`):

```sh
node scripts/import-fixtures.mjs
# o con otra ruta al index.ts de las fixtures:
FIXTURES_PATH=/ruta/a/fixtures/index.ts node scripts/import-fixtures.mjs
```

El script carga las fixtures con `tsx`, las pasa a términos del back y reescribe estos archivos formateados con Prettier. Revisá el diff y commitealo: el seed no importa nada del front cuando corre.

`FIXTURE_COMBOS` es opcional: si las fixtures no lo exportan (el front antes de los combos), `combos.ts` sale con `SEED_COMBOS = []` y el resumen lo dice. Los combos del diseño llegan con la rama `feat/inicio-combos` del front. Con esa rama mergeada en `../frontend`, alcanza con `node scripts/import-fixtures.mjs`, sin `FIXTURES_PATH`. Mientras no esté mergeada, apuntá `FIXTURES_PATH` a las fixtures del worktree de esa rama (hoy `../frontend-inicio-combos`, que desaparece con el merge):

```sh
FIXTURES_PATH="../frontend-inicio-combos/packages/api-client/src/mock/fixtures/index.ts" node scripts/import-fixtures.mjs
```

## Mapeos

| Fixture del front                    | Base                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `product.sequence` (código "N°07")   | `products.sequence` 7; después del seed la secuencia queda en el máximo                                                    |
| `product.priceArs`                   | `products.price_ars` (`null` = a consultar)                                                                                |
| `product.status`                     | `products.status` (`published`, con `published_at` = fecha de alta)                                                        |
| `product.stock`                      | `inventory.on_hand` (0 = agotado); `reserved` arranca en 0 y el seed no lo toca                                            |
| `product.images[]`, `category.image` | `media_assets` (`provider` `local`, `public_id` y `url` tal cual) + `product_images` por posición                          |
| `review.*`                           | `reviews` con id UUID v5 de `(productSlug, authorName, createdAt)`; `verifiedPurchase` → `verified_purchase`               |
| `content.*`                          | `content_blocks` por `key`: `home`, `about`, `faq`, `footer`, `product-tabs`, `legal-terms`, `legal-privacy`               |
| `settings.*`                         | `settings` (fila `id = 1`) y `shipping_options` (por `method`)                                                             |
| `combo.*` (`FIXTURE_COMBOS`)         | `combos` con id UUID v5 de la clave del mock (`cmb-duo-imperial`) + `combo_items` (`position` 1..n, en el orden del combo) |

## Idempotencia

Todo es `upsert` por clave natural (`slug`, `(product_id, position)`, `key`, `id = 1`, `method`, id determinístico de la reseña o del combo) en una sola transacción: dos corridas seguidas dejan la base igual. Una corrida **pisa con los valores del diseño** las filas que siembra (no toca las demás) y no cambia el `sequence` de un producto que ya existe. Las piezas de cada combo del diseño se reemplazan enteras; los combos creados desde el dashboard tienen otro id (UUID v7) y el seed no los toca. La excepción es el admin semilla: se crea si falta y nunca se actualiza.

## Stock reservado y re-seed

Desde B4 los pedidos sin pagar reservan stock (`inventory.reserved` más una fila `stock_reservations` por producto, hasta `orders.reserved_until`), y la base exige `reserved <= on_hand`. Por eso el seed no pisa `on_hand` a ciegas: crea la fila con el valor del diseño y, si ya existe, la actualiza solo cuando el valor del diseño no queda por debajo de lo reservado (`UPDATE … WHERE reserved <= on_hand nuevo`). Si queda por debajo, deja la fila como estaba (ni `on_hand` ni `reserved` cambian) e imprime un aviso con el slug del producto, por ejemplo:

```text
Aviso: el stock de mate-torpedo-premium queda en 20 y no en 12, porque tiene 20 unidades reservadas.
```

Así se puede re-sembrar una base con pedidos vivos sin que choque el CHECK `inventory_reserved_check` y se deshaga todo el seed. Cuando esas reservas vencen o se liberan, la próxima corrida deja el `on_hand` del diseño. El seed no siembra pedidos (la demo del panel con `GLP-09001…09012` llega en B6) y no toca la secuencia `order_number_seq`.
