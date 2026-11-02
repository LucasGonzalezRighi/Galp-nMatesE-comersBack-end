# Datos del seed

Datos planos del diseño que `prisma/seed.ts` escribe en la base (`npm run db:seed` o `npx prisma db seed`, con la base ya migrada).

- `types.ts`: las formas, a mano.
- `categories.ts`, `products.ts`, `reviews.ts`, `content.ts`, `settings.ts`: **generados**, no se editan a mano.

## Regenerar desde las fixtures del front

Cuando cambian las fixtures del mock del front (`frontend/packages/api-client/src/mock/fixtures/`):

```sh
node scripts/import-fixtures.mjs
# o con otra ruta al index.ts de las fixtures:
FIXTURES_PATH=/ruta/a/fixtures/index.ts node scripts/import-fixtures.mjs
```

El script carga las fixtures con `tsx`, las pasa a términos del back y reescribe estos archivos formateados con Prettier. Revisá el diff y commitealo: el seed no importa nada del front cuando corre.

## Mapeos

| Fixture del front                    | Base                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `product.sequence` (código "N°07")   | `products.sequence` 7; después del seed la secuencia queda en el máximo                                      |
| `product.priceArs`                   | `products.price_ars` (`null` = a consultar)                                                                  |
| `product.status`                     | `products.status` (`published`, con `published_at` = fecha de alta)                                          |
| `product.stock`                      | `inventory.on_hand` (0 = agotado), `reserved` 0                                                              |
| `product.images[]`, `category.image` | `media_assets` (`provider` `local`, `public_id` y `url` tal cual) + `product_images` por posición            |
| `review.*`                           | `reviews` con id UUID v5 de `(productSlug, authorName, createdAt)`; `verifiedPurchase` → `verified_purchase` |
| `content.*`                          | `content_blocks` por `key`: `home`, `about`, `faq`, `footer`, `product-tabs`, `legal-terms`, `legal-privacy` |
| `settings.*`                         | `settings` (fila `id = 1`) y `shipping_options` (por `method`)                                               |

## Idempotencia

Todo es `upsert` por clave natural (`slug`, `(product_id, position)`, `key`, `id = 1`, `method`, id determinístico de la reseña) en una sola transacción: dos corridas seguidas dejan la base igual. Una corrida **pisa con los valores del diseño** las filas que siembra (no toca las demás) y no cambia el `sequence` de un producto que ya existe.
