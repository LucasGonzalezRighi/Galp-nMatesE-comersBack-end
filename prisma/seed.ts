// Seed de desarrollo con los datos del diseño (`prisma/seed-data/`, generados desde las fixtures
// del front por `scripts/import-fixtures.mjs`). Se corre con `npm run db:seed` o
// `npx prisma db seed`; es idempotente: cada fila se escribe con `upsert` por su clave natural y
// una segunda corrida deja la base igual (pisa con los valores del diseño las filas que siembra).
// Las excepciones: el admin semilla se crea solo si no existe y nunca se pisa su contraseña, y el
// stock (`on_hand`) nunca baja por debajo de lo reservado por pedidos vivos (lo avisa y lo deja).
import { createHash } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { argon2id, hash } from 'argon2'

import { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { SEED_ADMIN } from './seed-data/admin'
import { SEED_CATEGORIES } from './seed-data/categories'
import { SEED_COMBOS } from './seed-data/combos'
import { SEED_CONTENT_BLOCKS } from './seed-data/content'
import { SEED_PRODUCTS } from './seed-data/products'
import { SEED_REVIEWS } from './seed-data/reviews'
import { SEED_SETTINGS, SEED_SHIPPING_OPTIONS } from './seed-data/settings'
import type { SeedCombo, SeedImage, SeedProduct, SeedReview } from './seed-data/types'

/** Cuántas filas de cada tipo dejó sembradas (creó, actualizó o ya estaban) una corrida del seed. */
export interface SeedSummary {
  /** Líneas del catálogo. */
  categories: number
  /** Productos, cada uno con su stock y sus fotos. */
  products: number
  /** Reseñas. */
  reviews: number
  /** Contenidos editables. */
  contentBlocks: number
  /** Combos, cada uno con sus piezas. */
  combos: number
  /** Usuarios semilla: el admin, recién creado o el que ya estaba. */
  users: number
}

/** Cliente dentro de la transacción del seed. */
type Tx = Prisma.TransactionClient

/** Parámetros de argon2id de las contraseñas (Ruling B-6: 19 MiB, 2 pasadas, 1 hilo). */
const PASSWORD_HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/** Namespace UUID v5 fijo de las reseñas del seed (elegido una vez; no cambiarlo). */
const REVIEW_NAMESPACE = '6f1c7a52-9a4e-4d3b-8f0e-2b7d5c1e9a30'

/** Namespace UUID v5 fijo de los combos del seed (elegido una vez; no cambiarlo). */
const COMBO_NAMESPACE = 'b7446644-ef56-4a17-9184-e0751e818650'

/** Tiempo máximo de la transacción del seed: son unos 200 `upsert` en serie. */
const TRANSACTION_TIMEOUT_MS = 120_000

/**
 * UUID v5 (SHA-1, RFC 9562) de un nombre dentro de un namespace: siempre el mismo para el mismo
 * par, así una fila del seed cae siempre en el mismo id.
 *
 * @param namespace - UUID del namespace.
 * @param name - Nombre a identificar.
 * @returns El UUID v5.
 */
function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  const bytes = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6) // versión 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8) // variante RFC
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Id determinístico de una reseña del seed: UUID v5 de `productSlug|authorName|createdAt`.
 *
 * @param review - Reseña del seed.
 * @returns El UUID v5 de la reseña.
 */
function reviewSeedId(review: SeedReview): string {
  return uuidV5(REVIEW_NAMESPACE, `${review.productSlug}|${review.authorName}|${review.createdAt}`)
}

/**
 * Id determinístico de un combo del seed: UUID v5 de su clave del mock (`cmb-duo-imperial`).
 *
 * @param combo - Combo del seed.
 * @returns El UUID v5 del combo.
 */
export function comboSeedId(combo: Pick<SeedCombo, 'key'>): string {
  return uuidV5(COMBO_NAMESPACE, combo.key)
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
 * Las fotos que sobren de una corrida anterior (posiciones mayores) se borran. El stock se crea con
 * el `onHand` del diseño y en una nueva corrida se actualiza solo si no queda por debajo de lo
 * reservado (`reserved <= onHand`, en el mismo `UPDATE`); si no, la fila queda como estaba (no se
 * toca `reserved`) y se avisa por la salida estándar, como el resumen del seed.
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

  const { onHand } = product
  await tx.inventory.upsert({ where: { productId }, create: { productId, onHand }, update: {} })
  const { count } = await tx.inventory.updateMany({
    where: { productId, reserved: { lte: onHand } },
    data: { onHand },
  })
  if (count === 0) {
    const current = await tx.inventory.findUniqueOrThrow({ where: { productId } })
    process.stdout.write(
      `Aviso: el stock de ${product.slug} queda en ${String(current.onHand)} y no en ` +
        `${String(onHand)}, porque tiene ${String(current.reserved)} unidades reservadas.\n`,
    )
  }
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

/**
 * Siembra los combos por su id determinístico ({@link comboSeedId}) y reemplaza sus piezas, en el
 * orden del combo (`position` 1..n). Los combos creados desde el dashboard tienen otro id (UUID
 * v7), así que no se tocan.
 *
 * @throws {Error} Si una pieza de un combo no está en la base.
 */
async function seedCombos(tx: Tx): Promise<void> {
  const products = await tx.product.findMany({
    where: { slug: { in: [...new Set(SEED_COMBOS.flatMap((c) => c.productSlugs))] } },
    select: { id: true, slug: true },
  })
  const productIds = new Map(products.map((p) => [p.slug, p.id]))
  for (const combo of SEED_COMBOS) {
    const items = combo.productSlugs.map((slug, index) => {
      const productId = productIds.get(slug)
      if (productId === undefined) {
        throw new Error(`El combo ${combo.name} lleva ${slug}, que no existe`)
      }
      return { position: index + 1, productId }
    })
    const id = comboSeedId(combo)
    const data = {
      name: combo.name,
      description: combo.description,
      priceArs: combo.priceArs,
      status: combo.status,
      position: combo.position,
    }
    await tx.combo.upsert({ where: { id }, create: { id, ...data }, update: data })
    await tx.comboItem.deleteMany({ where: { comboId: id } })
    await tx.comboItem.createMany({ data: items.map((item) => ({ comboId: id, ...item })) })
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
 * Crea el admin semilla ({@link SEED_ADMIN}) si no existe, con la contraseña hasheada con
 * argon2id. Si ya existe no toca nada: ni la contraseña (puede haberse cambiado desde el panel),
 * ni el rol, ni el estado.
 *
 * @returns Cuántos usuarios semilla quedaron en la base (siempre 1).
 */
async function seedAdmin(tx: Tx): Promise<number> {
  const existing = await tx.user.findUnique({
    where: { email: SEED_ADMIN.email },
    select: { id: true },
  })
  if (existing === null) {
    await tx.user.create({
      data: {
        email: SEED_ADMIN.email,
        passwordHash: await hash(SEED_ADMIN.password, PASSWORD_HASH_OPTIONS),
        role: 'admin',
        status: 'active',
      },
    })
  }
  return 1
}

/**
 * Carga en la base los datos del diseño: 6 líneas, 27 productos publicados con fotos y stock,
 * 18 reseñas aprobadas, los 7 contenidos editables, los ajustes, las opciones de envío, los 5
 * combos (4 publicados y un borrador) y el admin semilla del panel.
 *
 * Es idempotente (todo es `upsert` por `slug`, `(productId, position)`, `key`, `id = 1`,
 * `method` o el id determinístico de la reseña o del combo; las piezas de cada combo se
 * reemplazan; el admin se crea solo si falta y nunca se pisa su
 * contraseña; el stock nunca baja de lo reservado) y corre en una sola transacción: o queda todo
 * o nada. Al final mueve la secuencia de `products.sequence` al máximo, porque el seed inserta los
 * correlativos a mano y el próximo alta no tiene que chocar. Las reseñas y los contenidos que crea quedan sin cliente ni editor
 * (`customer_id` y `updated_by` en null).
 *
 * @param prisma - Cliente de Prisma conectado a una base ya migrada.
 * @returns Cuántas filas de cada tipo dejó sembradas.
 * @throws {Error} Si un producto, una reseña o un combo apunta a algo que no está en el seed, o si
 *   la base rechaza una fila (la transacción se deshace entera).
 * @example
 * const summary = await seed(prisma)
 * // { categories: 6, products: 27, reviews: 18, contentBlocks: 7, combos: 5, users: 1 }
 */
export async function seed(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(
    async (tx) => {
      const categoryIds = await seedCategories(tx)
      for (const product of SEED_PRODUCTS) await seedProduct(tx, product, categoryIds)
      await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('products', 'sequence'), (SELECT MAX(sequence) FROM products))`
      await seedReviews(tx)
      await seedContentAndSettings(tx)
      await seedCombos(tx)
      const users = await seedAdmin(tx)
      return {
        categories: SEED_CATEGORIES.length,
        products: SEED_PRODUCTS.length,
        reviews: SEED_REVIEWS.length,
        contentBlocks: SEED_CONTENT_BLOCKS.length,
        combos: SEED_COMBOS.length,
        users,
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
        `${String(summary.reviews)} reseñas, ${String(summary.contentBlocks)} contenidos, ` +
        `${String(summary.combos)} combos y ` +
        `${String(summary.users)} usuario admin (${SEED_ADMIN.email}).\n`,
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
