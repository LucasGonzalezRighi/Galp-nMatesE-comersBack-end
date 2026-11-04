import { Logger } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { summarizeRatings } from '../../reviews/domain/rating'
import { isLeather, type Leather, Product, type TabsOverride } from '../domain/product.entity'

/**
 * Relaciones que se leen con cada producto: la línea, las fotos por posición (con el `alt` de este
 * producto, que es por uso), el stock y las puntuaciones de las reseñas aprobadas (para `rating`;
 * así la caché del catálogo lo incluye).
 */
export const PRODUCT_INCLUDE = {
  category: { select: { id: true, slug: true, name: true, group: true } },
  images: {
    orderBy: { position: 'asc' },
    select: {
      alt: true,
      mediaAsset: { select: { publicId: true, url: true, width: true, height: true } },
    },
  },
  inventory: { select: { onHand: true, reserved: true } },
  reviews: { where: { status: 'approved' }, select: { rating: true } },
} satisfies Prisma.ProductInclude

/** Fila de `products` con las relaciones de {@link PRODUCT_INCLUDE}. */
export type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>

/** Avisos de las filas que se leen con datos que el producto no admite (se ignoran). */
const logger = new Logger('ProductMapper')

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
 * Lee la columna `leathers` (`text[]`, con un CHECK que solo admite los de `Leather`).
 *
 * @param values - Valores guardados.
 * @returns Los cueros, tal cual (el producto los valida y los ordena).
 * @throws {TypeError} En español, si alguno no es un cuero.
 */
export function toLeathers(values: readonly string[]): Leather[] {
  return values.map((value) => {
    if (!isLeather(value)) throw new TypeError(`El cuero "${value}" guardado no existe.`)
    return value
  })
}

/**
 * Cueros que se leen de una fila: los de un mate. Un producto que no es mate no lleva cuero
 * (la base no lo impide: el `CHECK` solo mira los valores), así que los suyos se ignoran con un
 * warn en vez de romper la lectura entera (el listado o la ficha con un 500).
 *
 * @param row - Slug, grupo de la línea y cueros guardados.
 * @returns Los cueros de un mate, o `[]` fuera de los mates.
 * @throws {TypeError} En español, si alguno no es un cuero.
 */
function leathersOf(row: Pick<ProductRow, 'slug' | 'leathers' | 'category'>): Leather[] {
  const leathers = toLeathers(row.leathers)
  if (row.category.group === 'mate' || leathers.length === 0) return leathers
  logger.warn(
    `El producto ${row.slug} es del grupo ${row.category.group} y tiene cueros guardados (${leathers.join(', ')}): se ignoran, solo los mates llevan cuero.`,
  )
  return []
}

/**
 * Pasa una fila de Prisma al producto del dominio. `rating` y los decimales se convierten a
 * `number`; sin fila de stock, el producto queda sin unidades; los cueros de un producto que no
 * es mate se ignoran (con un warn).
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
    images: row.images.map(({ alt, mediaAsset }) => ({ ...mediaAsset, alt })),
    inventory: row.inventory ?? { onHand: 0, reserved: 0 },
    tabsOverride: toTabsOverride(row.tabsOverride),
    rating: summarizeRatings(row.reviews.map(({ rating }) => rating.toNumber())),
    leathers: leathersOf(row),
  })
}
