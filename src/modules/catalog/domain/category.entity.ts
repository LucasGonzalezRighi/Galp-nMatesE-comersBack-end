import { createProductImage, type ProductImage } from './product-image.entity'

/** Grupos de productos de la tienda. */
export const PRODUCT_GROUPS = ['mate', 'bombilla', 'yerba'] as const

/** Grupo de un producto (y de su línea). */
export type ProductGroup = (typeof PRODUCT_GROUPS)[number]

/**
 * Indica si un texto es un grupo de productos.
 *
 * @param value - Texto a revisar.
 * @returns `true` si es un {@link ProductGroup}.
 */
export function isProductGroup(value: string): value is ProductGroup {
  return (PRODUCT_GROUPS as readonly string[]).includes(value)
}

/** Línea del catálogo (Imperiales, Torpedos, Bombillones…). */
export interface Category {
  /** Id de la línea. */
  id: string
  /** Slug único. */
  slug: string
  /** Nombre visible. */
  name: string
  /** Grupo de sus productos. */
  group: ProductGroup
  /** Bajada corta. */
  blurb: string
  /** Foto de la línea, o `null` (la tienda muestra un placeholder). */
  image: ProductImage | null
  /** Orden en la tienda, desde 1. */
  position: number
}

/**
 * Crea una línea validada.
 *
 * @param props - Datos de la línea.
 * @returns Una copia de la línea, ya validada.
 * @throws {TypeError} En español, si falta el id, el slug o el nombre, o el grupo no existe.
 * @throws {RangeError} En español, si la posición no es un entero desde 1 o la foto no es válida.
 */
export function createCategory(props: Category): Category {
  if (props.id.trim() === '' || props.slug.trim() === '' || props.name.trim() === '') {
    throw new TypeError('Una línea necesita su id, su slug y su nombre.')
  }
  if (!isProductGroup(props.group)) {
    throw new TypeError(`El grupo "${String(props.group)}" de la línea ${props.slug} no existe.`)
  }
  if (!Number.isInteger(props.position) || props.position < 1) {
    throw new RangeError(
      `La posición de la línea ${props.slug} tiene que ser un entero desde 1; se recibió ${String(props.position)}.`,
    )
  }
  return {
    id: props.id,
    slug: props.slug,
    name: props.name,
    group: props.group,
    blurb: props.blurb,
    image: props.image === null ? null : createProductImage(props.image),
    position: props.position,
  }
}
