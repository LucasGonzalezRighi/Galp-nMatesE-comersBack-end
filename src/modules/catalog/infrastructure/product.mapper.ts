import type { Prisma } from '../../../generated/prisma/client'
import { summarizeRatings } from '../../reviews/domain/rating'
import { Product, type TabsOverride } from '../domain/product.entity'

/**
 * Relaciones que se leen con cada producto: la línea, las fotos por posición, el stock y las
 * puntuaciones de las reseñas aprobadas (para `rating`; así la caché del catálogo lo incluye).
 */
export const PRODUCT_INCLUDE = {
  category: { select: { id: true, slug: true, name: true, group: true } },
  images: {
    orderBy: { position: 'asc' },
    select: {
      mediaAsset: { select: { publicId: true, url: true, width: true, height: true, alt: true } },
    },
  },
  inventory: { select: { onHand: true, reserved: true } },
  reviews: { where: { status: 'approved' }, select: { rating: true } },
} satisfies Prisma.ProductInclude

/** Fila de `products` con las relaciones de {@link PRODUCT_INCLUDE}. */
export type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>

/** Lee un texto de un objeto JSON, o `null` si no está o no es texto. */
function textField(json: Prisma.JsonValue, field: string): string | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const value = json[field]
  return typeof value === 'string' ? value : null
}

/**
 * Pasa `tabs_override` (JSON) a los textos propios de las pestañas.
 *
 * @param json - Columna `tabs_override`: `null` o `{ materials?, care? }`.
 * @returns Los textos propios, o `null` si el producto usa los del grupo.
 */
export function toTabsOverride(json: Prisma.JsonValue): TabsOverride | null {
  if (json === null) return null
  return { materials: textField(json, 'materials'), care: textField(json, 'care') }
}

/**
 * Pasa una fila de Prisma al producto del dominio. `rating` y los decimales se convierten a
 * `number`; sin fila de stock, el producto queda sin unidades.
 *
 * @param row - Producto con sus relaciones.
 * @returns El producto validado.
 * @throws {RangeError | TypeError} En español, si la fila no cumple las reglas del producto.
 */
export function toProduct(row: ProductRow): Product {
  return Product.create({
    id: row.id,
    sequence: row.sequence,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceArs: row.priceArs,
    status: row.status,
    featured: row.featured,
    category: { ...row.category },
    images: row.images.map(({ mediaAsset }) => ({ ...mediaAsset })),
    inventory: row.inventory ?? { onHand: 0, reserved: 0 },
    tabsOverride: toTabsOverride(row.tabsOverride),
    rating: summarizeRatings(row.reviews.map(({ rating }) => rating.toNumber())),
  })
}
