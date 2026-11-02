// Formas de los datos del seed: planas, en términos del back (slugs en vez de ids del mock del
// front) y sin dependencias, para que `prisma/seed.ts` las escriba en la base tal cual.

/** Valor JSON que se guarda en una columna `jsonb`. */
export type SeedJson = string | number | boolean | null | readonly SeedJson[] | SeedJsonObject

/** Objeto JSON de una columna `jsonb`. */
export interface SeedJsonObject {
  readonly [key: string]: SeedJson
}

/** Foto del diseño; se guarda en `media_assets` con `provider` `local`. */
export interface SeedImage {
  /** Identificador estable de la foto (`galpon/productos/{archivo}`), único en `media_assets`. */
  publicId: string
  /** Ruta que sirve la tienda (`/mock-images/{archivo}.jpg`). */
  url: string
  /** Ancho real del archivo, en píxeles. */
  width: number
  /** Alto real del archivo, en píxeles. */
  height: number
  /** Texto alternativo. */
  alt: string
}

/** Línea del catálogo. */
export interface SeedCategory {
  /** Slug único de la línea. */
  slug: string
  /** Nombre visible. */
  name: string
  /** Grupo de productos al que pertenece. */
  group: 'mate' | 'bombilla' | 'yerba'
  /** Bajada corta de la línea. */
  blurb: string
  /** Orden en la tienda, desde 1. */
  position: number
  /** Foto de la línea, o `null` si muestra el placeholder. */
  image: SeedImage | null
}

/** Textos propios de las pestañas Materiales y Cuidado de un producto. */
export interface SeedTabsOverride extends SeedJsonObject {
  /** Texto de Materiales, si el producto tiene uno propio. */
  materials?: string
  /** Texto de Cuidado, si el producto tiene uno propio. */
  care?: string
}

/** Producto del catálogo con su stock y sus fotos. */
export interface SeedProduct {
  /** Correlativo del que sale el código (`7` → "N°07"). */
  sequence: number
  /** Slug único del producto. */
  slug: string
  /** Slug de la línea a la que pertenece. */
  categorySlug: string
  /** Nombre del producto. */
  name: string
  /** Descripción del producto. */
  description: string
  /** Precio en pesos enteros, o `null` si es "a consultar". */
  priceArs: number | null
  /** Estado de publicación. */
  status: 'draft' | 'published' | 'archived'
  /** Si aparece entre los destacados. */
  featured: boolean
  /** Unidades en el depósito (`inventory.on_hand`); 0 es agotado. */
  onHand: number
  /** Fotos en el orden de la galería; la primera es la principal. */
  images: readonly SeedImage[]
  /** Textos propios de las pestañas, o `null` para usar los del grupo. */
  tabsOverride: SeedTabsOverride | null
  /** Fecha de alta (y de publicación, si está publicado), ISO 8601 con zona. */
  createdAt: string
}

/** Reseña de un producto. */
export interface SeedReview {
  /** Slug del producto reseñado. */
  productSlug: string
  /** Nombre con el que firma. */
  authorName: string
  /** Puntaje de 1 a 5, con medias estrellas (4,5). */
  rating: number
  /** Texto de la reseña. */
  text: string
  /** Fecha de la reseña, ISO 8601 con zona. */
  createdAt: string
  /** Estado de moderación. */
  status: 'pending' | 'approved' | 'hidden'
  /** Si aparece en el inicio. */
  featured: boolean
}

/** Clave de un contenido editable (`content_blocks.key`). */
export type SeedContentKey =
  'home' | 'about' | 'faq' | 'footer' | 'product-tabs' | 'legal-terms' | 'legal-privacy'

/** Contenido editable por clave. */
export interface SeedContentBlock {
  /** Clave del contenido. */
  key: SeedContentKey
  /** Datos con la forma del contenido en el contrato (`HomeContent`, `FaqContent`…). */
  data: SeedJsonObject
}

/** Ajustes de la tienda (fila única `settings.id = 1`). */
export interface SeedSettings {
  /** Descuento del kit, en porcentaje. */
  kitDiscountPercent: number
  /** Cuotas sin interés máximas. */
  installmentsMax: number
  /** Si las cuotas se muestran en la ficha de producto. */
  installmentsShowOnProduct: boolean
  /** Email de contacto de la tienda. */
  contactEmail: string
  /** Unidades desde las que un producto se muestra con poco stock. */
  lowStockThreshold: number
  /** Alícuota de IVA, en porcentaje. */
  vatRatePercent: number
  /** Si se muestra el precio sin impuestos nacionales. */
  showNetPrice: boolean
  /** Datos del vendedor, con `null` en lo que todavía no se cargó. */
  seller: SeedJsonObject
}

/** Opción de envío del checkout. */
export interface SeedShippingOption {
  /** Método de envío (clave de `shipping_options`). */
  method: 'home' | 'branch' | 'pickup'
  /** Nombre visible. */
  label: string
  /** Costo en pesos enteros. */
  costArs: number
  /** Plazo estimado de entrega. */
  eta: string
  /** Si se puede elegir en el checkout. */
  enabled: boolean
}
