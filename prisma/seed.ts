// Seed de desarrollo con los datos del diseño (`prisma/seed-data/`, generados desde las fixtures
// del front por `scripts/import-fixtures.mjs`). Se corre con `npm run db:seed` o
// `npx prisma db seed`; es idempotente: cada fila se escribe con `upsert` por su clave natural y
// una segunda corrida deja la base igual (pisa con los valores del diseño las filas que siembra).
import { createHash } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'

import { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { SEED_CATEGORIES } from './seed-data/categories'
import { SEED_CONTENT_BLOCKS } from './seed-data/content'
import { SEED_PRODUCTS } from './seed-data/products'
import { SEED_REVIEWS } from './seed-data/reviews'
import { SEED_SETTINGS, SEED_SHIPPING_OPTIONS } from './seed-data/settings'
import type { SeedImage, SeedProduct, SeedReview } from './seed-data/types'

/** Cuántas filas de cada tipo escribió (creó o actualizó) una corrida del seed. */
export interface SeedSummary {
  /** Líneas del catálogo. */
  categories: number
  /** Productos, cada uno con su stock y sus fotos. */
  products: number
  /** Reseñas. */
  reviews: number
  /** Contenidos editables. */
  contentBlocks: number
}

/** Cliente dentro de la transacción del seed. */
type Tx = Prisma.TransactionClient

/** Namespace UUID v5 fijo de las reseñas del seed (elegido una vez; no cambiarlo). */
const REVIEW_NAMESPACE = '6f1c7a52-9a4e-4d3b-8f0e-2b7d5c1e9a30'

/** Tiempo máximo de la transacción del seed: son unos 200 `upsert` en serie. */
const TRANSACTION_TIMEOUT_MS = 120_000

/**
 * Id determinístico de una reseña del seed: UUID v5 (SHA-1, RFC 9562) de
 * `productSlug|authorName|createdAt`, para que la misma reseña caiga siempre en la misma fila.
 *
 * @param review - Reseña del seed.
 * @returns El UUID v5 de la reseña.
 */
function reviewSeedId(review: SeedReview): string {
  const namespace = Buffer.from(REVIEW_NAMESPACE.replaceAll('-', ''), 'hex')
  const name = `${review.productSlug}|${review.authorName}|${review.createdAt}`
  const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16)
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6) // versión 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8) // variante RFC
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Escribe (o actualiza) una foto en `media_assets` por su `publicId`.
 *
 * @returns El id del asset.
 */
async function upsertMediaAsset(tx: Tx, image: SeedImage): Promise<string> {
  const { publicId, url, width, height, alt } = image
  const asset = await tx.mediaAsset.upsert({
    where: { publicId },
    create: { provider: 'local', publicId, url, width, height, alt },
    update: { provider: 'local', url, width, height, alt },
    select: { id: true },
  })
  return asset.id
}

/**
 * Siembra las líneas del catálogo, por `slug`.
 *
 * @returns El id de cada línea, por slug.
 */
async function seedCategories(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const category of SEED_CATEGORIES) {
    const imageId = category.image === null ? null : await upsertMediaAsset(tx, category.image)
    const data = {
      name: category.name,
      group: category.group,
      blurb: category.blurb,
      position: category.position,
      imageId,
    }
    const saved = await tx.category.upsert({
      where: { slug: category.slug },
      create: { slug: category.slug, ...data },
      update: data,
      select: { id: true },
    })
    ids.set(category.slug, saved.id)
  }
  return ids
}

/**
 * Siembra un producto por `slug`, con sus fotos por `(productId, position)` y su stock.
 *
 * El `sequence` (el código "N°07") solo se fija al crearlo: es la identidad visible del producto.
 * Las fotos que sobren de una corrida anterior (posiciones mayores) se borran.
 *
 * @throws {Error} Si la línea del producto no está en el seed.
 */
async function seedProduct(
  tx: Tx,
  product: SeedProduct,
  categoryIds: ReadonlyMap<string, string>,
): Promise<void> {
  const categoryId = categoryIds.get(product.categorySlug)
  if (categoryId === undefined) {
    throw new Error(
      `El producto ${product.slug} es de la línea ${product.categorySlug}, que no está en el seed`,
    )
  }
  const createdAt = new Date(product.createdAt)
  const data = {
    categoryId,
    name: product.name,
    description: product.description,
    priceArs: product.priceArs,
    status: product.status,
    featured: product.featured,
    tabsOverride: product.tabsOverride ?? Prisma.DbNull,
    publishedAt: product.status === 'published' ? createdAt : null,
  }
  const { id: productId } = await tx.product.upsert({
    where: { slug: product.slug },
    create: { sequence: product.sequence, slug: product.slug, createdAt, ...data },
    update: data,
    select: { id: true },
  })

  for (const [index, image] of product.images.entries()) {
    const mediaAssetId = await upsertMediaAsset(tx, image)
    const position = index + 1
    await tx.productImage.upsert({
      where: { productId_position: { productId, position } },
      create: { productId, position, mediaAssetId },
      update: { mediaAssetId },
    })
  }
  await tx.productImage.deleteMany({
    where: { productId, position: { gt: product.images.length } },
  })

  await tx.inventory.upsert({
    where: { productId },
    create: { productId, onHand: product.onHand },
    update: { onHand: product.onHand },
  })
}

/**
 * Siembra las reseñas, por su id determinístico ({@link reviewSeedId}).
 *
 * @throws {Error} Si el producto de una reseña no está en la base.
 */
async function seedReviews(tx: Tx): Promise<void> {
  const products = await tx.product.findMany({
    where: { slug: { in: [...new Set(SEED_REVIEWS.map((r) => r.productSlug))] } },
    select: { id: true, slug: true },
  })
  const productIds = new Map(products.map((p) => [p.slug, p.id]))
  for (const review of SEED_REVIEWS) {
    const productId = productIds.get(review.productSlug)
    if (productId === undefined) {
      throw new Error(
        `La reseña de ${review.authorName} es de ${review.productSlug}, que no existe`,
      )
    }
    const id = reviewSeedId(review)
    const createdAt = new Date(review.createdAt)
    const data = {
      productId,
      authorName: review.authorName,
      rating: review.rating,
      text: review.text,
      status: review.status,
      featured: review.featured,
      verifiedPurchase: review.verifiedPurchase,
      moderatedAt: review.status === 'pending' ? null : createdAt,
    }
    await tx.review.upsert({
      where: { id },
      create: { id, createdAt, ...data },
      update: data,
    })
  }
}

/** Siembra los contenidos editables (por `key`), los ajustes (`id = 1`) y los envíos (`method`). */
async function seedContentAndSettings(tx: Tx): Promise<void> {
  for (const block of SEED_CONTENT_BLOCKS) {
    await tx.contentBlock.upsert({
      where: { key: block.key },
      create: { key: block.key, data: block.data },
      update: { data: block.data },
    })
  }

  await tx.settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...SEED_SETTINGS },
    update: SEED_SETTINGS,
  })

  for (const option of SEED_SHIPPING_OPTIONS) {
    const { method, ...data } = option
    await tx.shippingOption.upsert({ where: { method }, create: option, update: data })
  }
}

/**
 * Carga en la base los datos del diseño: 6 líneas, 27 productos publicados con fotos y stock,
 * 15 reseñas aprobadas, los 7 contenidos editables, los ajustes y las opciones de envío.
 *
 * Es idempotente (todo es `upsert` por `slug`, `(productId, position)`, `key`, `id = 1`,
 * `method` o el id determinístico de la reseña) y corre en una sola transacción: o queda todo o
 * nada. Al final mueve la secuencia de `products.sequence` al máximo, porque el seed inserta los
 * correlativos a mano y el próximo alta no tiene que chocar.
 *
 * @param prisma - Cliente de Prisma conectado a una base ya migrada.
 * @returns Cuántas filas de cada tipo escribió.
 * @throws {Error} Si un producto o una reseña apunta a algo que no está en el seed, o si la base
 *   rechaza una fila (la transacción se deshace entera).
 * @example
 * const summary = await seed(prisma) // { categories: 6, products: 27, reviews: 15, contentBlocks: 7 }
 */
export async function seed(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(
    async (tx) => {
      const categoryIds = await seedCategories(tx)
      for (const product of SEED_PRODUCTS) await seedProduct(tx, product, categoryIds)
      await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('products', 'sequence'), (SELECT MAX(sequence) FROM products))`
      await seedReviews(tx)
      await seedContentAndSettings(tx)
      return {
        categories: SEED_CATEGORIES.length,
        products: SEED_PRODUCTS.length,
        reviews: SEED_REVIEWS.length,
        contentBlocks: SEED_CONTENT_BLOCKS.length,
      }
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  )
}

/**
 * Entrada de `npm run db:seed` / `prisma db seed`: siembra la base de `DATABASE_URL` (del entorno
 * o de `.env`) y cierra la conexión.
 *
 * @throws {Error} Si falta `DATABASE_URL` o si el seed falla.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Sin `.env`: valen las variables del entorno.
  }
  const connectionString = process.env.DATABASE_URL
  if (connectionString === undefined || connectionString === '') {
    throw new Error('Falta DATABASE_URL: definila en el entorno o en .env para correr el seed')
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  try {
    const summary = await seed(prisma)
    process.stdout.write(
      `Seed listo: ${String(summary.categories)} categorías, ${String(summary.products)} productos, ` +
        `${String(summary.reviews)} reseñas y ${String(summary.contentBlocks)} contenidos.\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `No se pudo correr el seed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
