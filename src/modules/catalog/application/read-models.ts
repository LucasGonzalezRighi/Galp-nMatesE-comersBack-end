// Formas de lectura del catálogo: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

import type { ProductGroup } from '../domain/category.entity'
import type { ProductOptions, ProductTabs } from '../domain/product.entity'

export type { ProductGroup } from '../domain/category.entity'
export type { ProductOptions, ProductTabs } from '../domain/product.entity'

/** Órdenes del listado (`ProductSortOrder`). */
export const PRODUCT_SORT_ORDERS = ['destacados', 'menor', 'mayor', 'az'] as const

/** Orden del listado de productos. */
export type ProductSortOrder = (typeof PRODUCT_SORT_ORDERS)[number]

/** Foto (`Image`). */
export interface Image {
  /** Identificador estable de la foto. */
  publicId: string
  /** URL que sirve la tienda. */
  url: string
  /** Ancho en píxeles. */
  width: number
  /** Alto en píxeles. */
  height: number
  /** Texto alternativo. */
  alt: string
}

/** Calificación de un producto (`Rating`). */
export interface Rating {
  /** Promedio sin redondear, de 0 a 5. */
  average: number
  /** Cantidad de reseñas aprobadas. */
  count: number
}

/** Línea del catálogo con la cantidad de productos publicados (`Category`). */
export interface Category {
  /** Id de la línea. */
  id: string
  /** Slug. */
  slug: string
  /** Nombre. */
  name: string
  /** Grupo. */
  group: ProductGroup
  /** Bajada corta. */
  blurb: string
  /** Foto, o `null`. */
  image: Image | null
  /** Orden en la tienda, desde 1. */
  position: number
  /** Productos publicados de la línea. */
  productCount: number
}

/** Producto como se muestra en los listados (`ProductSummary`). */
export interface ProductSummary {
  /** Id. */
  id: string
  /** Slug actual. */
  slug: string
  /** Código visible ("N°07"). */
  code: string
  /** Nombre. */
  name: string
  /** Descripción. */
  description: string
  /** Id de la línea. */
  categoryId: string
  /** Slug de la línea. */
  categorySlug: string
  /** Nombre de la línea. */
  categoryName: string
  /** Grupo. */
  group: ProductGroup
  /** Precio final, o `null` si es "a consultar". */
  priceArs: number | null
  /** Precio sin impuestos nacionales, o `null` si no se muestra o es "a consultar". */
  netPriceArs: number | null
  /** Si se puede agregar al carrito. */
  isPurchasable: boolean
  /** Si no queda stock disponible. */
  isSoldOut: boolean
  /** Máximo de unidades por compra (0 a 20). */
  maxQuantity: number
  /** Si es destacado. */
  featured: boolean
  /** Foto principal, o `null`. */
  mainImage: Image | null
  /** Calificación con las reseñas aprobadas. */
  rating: Rating
}

/** Ficha del producto (`ProductDetail`). */
export interface ProductDetail extends ProductSummary {
  /** Todas las fotos, la principal primero. */
  images: Image[]
  /** Pestañas de la ficha. */
  tabs: ProductTabs
  /** Cueros y virolas en los mates; `null` en el resto. */
  options: ProductOptions | null
}

/** Página de productos (`ProductPage`). */
export interface ProductPage {
  /** Productos de la página. */
  items: ProductSummary[]
  /** Número de página, desde 1. */
  page: number
  /** Productos por página (1 a 100). */
  pageSize: number
  /** Total de productos que cumplen el filtro. */
  total: number
}
