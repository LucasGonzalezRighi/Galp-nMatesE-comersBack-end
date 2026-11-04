import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import { storefrontStaleEvent } from '../../../shared/domain/storefront-tags'
import type { ProductStatus } from './product.entity'

/** Motivos del aviso a la tienda de una escritura de productos del dashboard. */
export const PRODUCT_CHANGE_REASONS = [
  'product.created',
  'product.updated',
  'product.archived',
] as const

/** Motivo del aviso de una escritura de productos. */
export type ProductChangeReason = (typeof PRODUCT_CHANGE_REASONS)[number]

/** Motivos del aviso a la tienda de una escritura de líneas del dashboard. */
export const CATEGORY_CHANGE_REASONS = [
  'category.created',
  'category.updated',
  'category.deleted',
  'category.reordered',
] as const

/** Motivo del aviso de una escritura de líneas. */
export type CategoryChangeReason = (typeof CATEGORY_CHANGE_REASONS)[number]

/** Etiquetas de una escritura de líneas: las líneas y los productos (muestran su línea). */
export const CATEGORY_STOREFRONT_TAGS = ['categories', 'products'] as const

/**
 * Aviso a la tienda de un alta, edición o archivo de un producto (Ruling B-73): `products`, la
 * ficha del slug nuevo, la del anterior si cambió, `categories` (cambia `productCount`) y
 * `combos`. Va en la misma transacción que la escritura.
 *
 * @param reason - `product.created`, `product.updated` o `product.archived`.
 * @param slug - Slug con el que queda el producto.
 * @param previousSlug - Slug que tenía antes de esta escritura, o `null` en un alta.
 * @returns El evento `storefront.stale`.
 * @throws {RangeError} En español, si el motivo no es de productos o un slug no sirve de etiqueta.
 */
export function productStorefrontEvent(
  reason: ProductChangeReason,
  slug: string,
  previousSlug: string | null,
): NewDomainEvent {
  if (!(PRODUCT_CHANGE_REASONS as readonly string[]).includes(reason)) {
    throw new RangeError(`"${reason}" no es un motivo de cambio de productos.`)
  }
  const previous = previousSlug !== null && previousSlug !== slug ? [`product:${previousSlug}`] : []
  return storefrontStaleEvent(reason, [
    'products',
    `product:${slug}`,
    ...previous,
    'categories',
    'combos',
  ])
}

/**
 * Aviso a la tienda de un alta, edición, borrado u orden de líneas (Ruling B-73): `categories` y
 * `products`.
 *
 * @param reason - Motivo de la escritura.
 * @returns El evento `storefront.stale`.
 * @throws {RangeError} En español, si el motivo no es de líneas.
 */
export function categoryStorefrontEvent(reason: CategoryChangeReason): NewDomainEvent {
  if (!(CATEGORY_CHANGE_REASONS as readonly string[]).includes(reason)) {
    throw new RangeError(`"${reason}" no es un motivo de cambio de líneas.`)
  }
  return storefrontStaleEvent(reason, CATEGORY_STOREFRONT_TAGS)
}

/**
 * Fecha de publicación después de guardar (Ruling B-81): se pone la primera vez que el producto
 * queda publicado y después se conserva (aunque vuelva a borrador o se archive).
 *
 * @param previous - `publishedAt` guardado, o `null` si nunca se publicó.
 * @param status - Estado con el que queda.
 * @param now - Momento de la escritura.
 * @returns La fecha a guardar.
 */
export function publishedAtAfterSave(
  previous: Date | null,
  status: ProductStatus,
  now: Date,
): Date | null {
  if (previous !== null) return previous
  return status === 'published' ? now : null
}
