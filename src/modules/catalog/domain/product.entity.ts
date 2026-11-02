import { isProductGroup, type ProductGroup } from './category.entity'
import { Inventory, type InventoryProps } from './inventory.entity'
import { createProductImage, type ProductImage } from './product-image.entity'

export { MAX_QUANTITY_PER_PRODUCT } from './inventory.entity'

/** Estados de publicación de un producto. */
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const

/** Estado de publicación de un producto. */
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** Colores de cuero que se pueden elegir en un mate. */
export const LEATHERS = ['Negro', 'Marrón', 'Crudo', 'Borravino'] as const

/** Virolas que se pueden elegir en un mate. */
export const FERRULES = ['Alpaca lisa', 'Alpaca cincelada', 'Acero'] as const

/** Opciones de compra de un mate (`ProductOptions` del contrato). */
export interface ProductOptions {
  /** Colores de cuero. */
  leathers: (typeof LEATHERS)[number][]
  /** Virolas. */
  ferrules: (typeof FERRULES)[number][]
}

/** Línea a la que pertenece un producto, con lo que muestran los listados. */
export interface ProductCategory {
  /** Id de la línea. */
  id: string
  /** Slug de la línea. */
  slug: string
  /** Nombre de la línea. */
  name: string
  /** Grupo de la línea (y del producto). */
  group: ProductGroup
}

/** Textos propios de las pestañas Materiales y Cuidado; `null` usa el del grupo. */
export interface TabsOverride {
  /** Texto propio de Materiales, o `null`. */
  materials: string | null
  /** Texto propio de Cuidado, o `null`. */
  care: string | null
}

/** Textos de las pestañas de un grupo (los del contenido `product-tabs`). */
export interface GroupTabsTexts {
  /** Nota bajo la descripción, o `null`. */
  descriptionNote: string | null
  /** Texto de Materiales del grupo. */
  materials: string
  /** Texto de Cuidado del grupo. */
  care: string
}

/** Pestañas de la ficha ya combinadas (`ProductTabs` del contrato). */
export interface ProductTabs {
  /** Nota bajo la descripción, o `null`. */
  descriptionNote: string | null
  /** Materiales: el texto propio del producto o el del grupo. */
  materials: string
  /** Envíos, común a todos. */
  shipping: string
  /** Cuidado: el texto propio del producto o el del grupo. */
  care: string
}

/** Promedio y cantidad de reseñas aprobadas del producto. */
export interface ProductRating {
  /** Promedio sin redondear, de 0 a 5. */
  average: number
  /** Cantidad de reseñas aprobadas. */
  count: number
}

/** Datos planos de un producto: lo que lee el repositorio y lo que guarda la caché. */
export interface ProductProps {
  /** Id del producto. */
  id: string
  /** Correlativo del que sale el código ("N°07"). */
  sequence: number
  /** Slug actual. */
  slug: string
  /** Nombre. */
  name: string
  /** Descripción. */
  description: string
  /** Precio final en pesos enteros, o `null` si es "a consultar". */
  priceArs: number | null
  /** Estado de publicación. */
  status: ProductStatus
  /** Si es destacado. */
  featured: boolean
  /** Línea a la que pertenece. */
  category: ProductCategory
  /** Fotos en el orden de la galería; la primera es la principal. */
  images: ProductImage[]
  /** Stock. */
  inventory: InventoryProps
  /** Textos propios de las pestañas, o `null` para usar los del grupo. */
  tabsOverride: TabsOverride | null
  /** Calificación con las reseñas aprobadas. */
  rating: ProductRating
}

/** Revisa que un texto obligatorio no esté vacío. */
function assertText(value: string, message: string): void {
  if (value.trim() === '') throw new TypeError(message)
}

/** Producto del catálogo con sus reglas de venta (código, compra, stock, precio sin IVA). */
export class Product {
  private constructor(
    private readonly props: ProductProps,
    private readonly inventory: Inventory,
  ) {}

  /**
   * Crea un producto validado.
   *
   * @param props - Datos del producto (de la base o de la caché).
   * @returns El producto.
   * @throws {TypeError} En español, si falta el id, el slug, el nombre o la línea, o el estado o
   *   el grupo no existen.
   * @throws {RangeError} En español, si el correlativo, el precio, el stock, las fotos o la
   *   calificación están fuera de rango.
   */
  static create(props: ProductProps): Product {
    assertText(props.id, 'Un producto necesita su id.')
    assertText(props.slug, 'Un producto necesita su slug.')
    assertText(props.name, `El producto ${props.slug} necesita un nombre.`)
    if (!Number.isInteger(props.sequence) || props.sequence < 1) {
      throw new RangeError(
        `El correlativo del producto tiene que ser un entero desde 1; se recibió ${String(props.sequence)}.`,
      )
    }
    if (props.priceArs !== null && (!Number.isSafeInteger(props.priceArs) || props.priceArs < 0)) {
      throw new RangeError(
        `El precio de ${props.slug} tiene que ser un entero desde 0 o null; se recibió ${String(props.priceArs)}.`,
      )
    }
    if (!(PRODUCT_STATUSES as readonly string[]).includes(props.status)) {
      throw new TypeError(`El estado "${props.status}" del producto no existe.`)
    }
    assertText(props.category.id, `El producto ${props.slug} necesita su línea.`)
    if (!isProductGroup(props.category.group)) {
      throw new TypeError(`El grupo "${String(props.category.group)}" del producto no existe.`)
    }
    const { average, count } = props.rating
    if (!Number.isFinite(average) || average < 0 || average > 5) {
      throw new RangeError(
        `El promedio de reseñas tiene que estar entre 0 y 5; se recibió ${String(average)}.`,
      )
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `La cantidad de reseñas tiene que ser un entero desde 0; se recibió ${String(count)}.`,
      )
    }
    const inventory = Inventory.create(props.inventory)
    return new Product(
      {
        ...props,
        category: { ...props.category },
        images: props.images.map(createProductImage),
        inventory: inventory.toProps(),
        tabsOverride: props.tabsOverride === null ? null : { ...props.tabsOverride },
        rating: { average, count },
      },
      inventory,
    )
  }

  /** Id del producto. */
  get id(): string {
    return this.props.id
  }

  /** Slug actual. */
  get slug(): string {
    return this.props.slug
  }

  /** Id de su línea. */
  get categoryId(): string {
    return this.props.category.id
  }

  /** Grupo del producto (el de su línea). */
  get group(): ProductGroup {
    return this.props.category.group
  }

  /** Código visible: "N°" y el correlativo con al menos dos dígitos ("N°07"). */
  code(): string {
    return `N°${String(this.props.sequence).padStart(2, '0')}`
  }

  /** Si se puede agregar al carrito: publicado, con precio y con al menos una unidad disponible. */
  isPurchasable(): boolean {
    return (
      this.props.status === 'published' && this.props.priceArs !== null && this.maxQuantity() > 0
    )
  }

  /** Si no queda nada disponible. */
  isSoldOut(): boolean {
    return this.inventory.available() <= 0
  }

  /** Máximo de unidades que se pueden comprar (lo disponible, con tope 20). */
  maxQuantity(): number {
    return this.inventory.maxQuantity()
  }

  /**
   * Calcula el precio sin impuestos nacionales, con la fórmula del front (`netPrice`).
   *
   * @param vatRatePercent - Alícuota de IVA en porcentaje, de 0 a 100 (admite decimales).
   * @returns El precio dividido por `1 + alícuota / 100`, redondeado al peso, o `null` si el
   *   producto es "a consultar".
   * @throws {RangeError} En español, si la alícuota está fuera de rango.
   */
  netPriceArs(vatRatePercent: number): number | null {
    if (!Number.isFinite(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100) {
      throw new RangeError(
        `La alícuota tiene que ser un número entre 0 y 100; se recibió ${String(vatRatePercent)}.`,
      )
    }
    const price = this.props.priceArs
    return price === null ? null : Math.round(price / (1 + vatRatePercent / 100))
  }

  /** Opciones de compra: cueros y virolas en los mates, `null` en el resto. */
  options(): ProductOptions | null {
    return this.group === 'mate' ? { leathers: [...LEATHERS], ferrules: [...FERRULES] } : null
  }

  /** Foto principal (la primera de la galería), o `null` sin fotos. */
  mainImage(): ProductImage | null {
    const [first] = this.props.images
    return first === undefined ? null : { ...first }
  }

  /**
   * Combina las pestañas del grupo con los textos propios del producto.
   *
   * @param group - Textos de las pestañas del grupo del producto.
   * @param shipping - Texto de la pestaña Envíos, común a todos.
   * @returns Las pestañas: Materiales y Cuidado propios si los tiene, si no los del grupo.
   */
  tabs(group: GroupTabsTexts, shipping: string): ProductTabs {
    return {
      descriptionNote: group.descriptionNote,
      materials: this.props.tabsOverride?.materials ?? group.materials,
      shipping,
      care: this.props.tabsOverride?.care ?? group.care,
    }
  }

  /** Datos planos del producto (copia), para mapear o guardar en la caché. */
  toProps(): ProductProps {
    return {
      ...this.props,
      category: { ...this.props.category },
      images: this.props.images.map((image) => ({ ...image })),
      inventory: { ...this.props.inventory },
      tabsOverride: this.props.tabsOverride === null ? null : { ...this.props.tabsOverride },
      rating: { ...this.props.rating },
    }
  }
}

/** Lo mínimo para elegir relacionados. */
export interface RelatableProduct {
  /** Id del producto. */
  id: string
  /** Id de su línea. */
  categoryId: string
  /** Grupo del producto. */
  group: ProductGroup
}

/**
 * Elige los productos relacionados con uno, como el contrato y el front (`selectRelated`):
 * primero los de la misma línea (sin el propio) y después los del mismo grupo en otras líneas,
 * cada tramo en el orden recibido. Nunca incluye otro grupo.
 *
 * @param product - Producto del que se buscan relacionados.
 * @param catalog - Candidatos, en el orden del catálogo.
 * @param limit - Máximo de relacionados (entero desde 0).
 * @returns Hasta `limit` productos.
 * @throws {RangeError} En español, si el límite no es un entero desde 0.
 */
export function selectRelated<T extends RelatableProduct>(
  product: RelatableProduct,
  catalog: readonly T[],
  limit: number,
): T[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError(
      `El límite de relacionados tiene que ser un entero desde 0; se recibió ${String(limit)}.`,
    )
  }
  const sameGroup = catalog.filter(
    (other) => other.id !== product.id && other.group === product.group,
  )
  const sameLine = sameGroup.filter((other) => other.categoryId === product.categoryId)
  const otherLines = sameGroup.filter((other) => other.categoryId !== product.categoryId)
  return [...sameLine, ...otherLines].slice(0, limit)
}
