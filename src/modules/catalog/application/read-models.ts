// Formas de lectura del catálogo: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

import type { ProductGroup } from '../domain/category.entity'
import type { ComboStatus } from '../domain/combo.entity'
import type { Leather, ProductStatus, ProductTabs } from '../domain/product.entity'

export type { ProductGroup } from '../domain/category.entity'
export type { ComboStatus } from '../domain/combo.entity'
export type { Leather, ProductTabs } from '../domain/product.entity'

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
  /** Cueros que el cliente puede elegir, en el orden de `Leather`; vacío si no hay selector. */
  leathers: Leather[]
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

/** Producto fijo de un combo, con sus datos vigentes (`ComboItem`). */
export interface ComboItemView {
  /** Id del producto. */
  productId: string
  /** Slug actual del producto. */
  slug: string
  /** Nombre del producto. */
  name: string
  /** Grupo del producto. */
  group: ProductGroup
  /** Cueros que se pueden elegir de esta pieza; vacío si no es un mate o no tiene selector. */
  leathers: Leather[]
  /** Precio de lista vigente, o `null` si es "a consultar". */
  unitPriceArs: number | null
  /** Si el producto se puede vender ahora (publicado, con precio y con stock). */
  isPurchasable: boolean
  /** Unidades que se pueden pedir de una vez (0 a 20). */
  maxQuantity: number
  /** Foto principal, o `null`. */
  image: Image | null
}

/**
 * Combo como lo ven la tienda y el dashboard (`Combo`), con los derivados calculados con los
 * precios y el stock vigentes de sus piezas.
 */
export interface ComboView {
  /** Id del combo. */
  id: string
  /** Nombre. */
  name: string
  /** Descripción corta (puede ser vacía). */
  description: string
  /** Sus productos, en el orden en que los cargó el dashboard. */
  items: ComboItemView[]
  /** Precio final del combo. */
  priceArs: number
  /** Precio sin impuestos nacionales, o `null` si no se muestra. */
  netPriceArs: number | null
  /** Suma de los precios de lista vigentes de las piezas con precio. */
  listPriceArs: number
  /** Ahorro frente a las piezas sueltas (nunca negativo). */
  savingsArs: number
  /** Si se puede agregar al carrito. */
  isPurchasable: boolean
  /** Si alguna pieza se quedó sin stock disponible. */
  isSoldOut: boolean
  /** Combos que se pueden pedir de una vez (0 a 20). */
  maxQuantity: number
  /** Borrador o publicado. */
  status: ComboStatus
  /** Lugar en el listado, desde 1. */
  position: number
}

/** Textos propios de las pestañas de un producto (`ProductTabsOverride`); `null` usa el del grupo. */
export interface ProductTabsOverrideView {
  /** Materiales propio, o `null`. */
  materials: string | null
  /** Cuidado propio, o `null`. */
  care: string | null
}

/** Producto como lo ve el dashboard (`AdminProduct`): la ficha más lo que la tienda no muestra. */
export interface AdminProduct extends ProductDetail {
  /** Estado de publicación. */
  status: ProductStatus
  /** Unidades disponibles (`on_hand − reserved`; Ruling B-71). */
  stock: number
  /** Correlativo del que sale `code`. */
  sequence: number
  /** Textos propios de las pestañas, o `null` si usa los del grupo. */
  tabsOverride: ProductTabsOverrideView | null
  /** Slugs anteriores, del más viejo al más nuevo. */
  previousSlugs: string[]
  /** Alta, en ISO 8601 (UTC). */
  createdAt: string
  /** Última modificación, en ISO 8601 (UTC). */
  updatedAt: string
}

/** Página de productos del dashboard (`AdminProductPage`). */
export interface AdminProductPage {
  /** Productos de la página. */
  items: AdminProduct[]
  /** Número de página, desde 1. */
  page: number
  /** Productos por página que aplicó el servidor (1 a 100). */
  pageSize: number
  /** Total de productos que cumplen los filtros. */
  total: number
}
