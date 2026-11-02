import { PrismaPg } from '@prisma/adapter-pg'
import { argon2id, hash, verify } from 'argon2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import { PrismaClient } from '../../src/generated/prisma/client'
import { startContainers, type TestContainers } from '../support/containers'

/** Conteos de todas las tablas que toca el seed. */
async function countAll(db: PrismaClient): Promise<Record<string, number>> {
  const [categories, products, published, mediaAssets, productImages, inventory, reviews] =
    await Promise.all([
      db.category.count(),
      db.product.count(),
      db.product.count({ where: { status: 'published' } }),
      db.mediaAsset.count(),
      db.productImage.count(),
      db.inventory.count(),
      db.review.count(),
    ])
  const [contentBlocks, settings, shippingOptions, users] = await Promise.all([
    db.contentBlock.count(),
    db.settings.count(),
    db.shippingOption.count(),
    db.user.count(),
  ])
  return {
    categories,
    products,
    published,
    mediaAssets,
    productImages,
    inventory,
    reviews,
    contentBlocks,
    settings,
    shippingOptions,
    users,
  }
}

describe('seed', () => {
  let containers: TestContainers | undefined
  let prisma: PrismaClient | undefined

  /** El cliente de Prisma del test; falla claro si `beforeAll` no llegó a crearlo. */
  function db(): PrismaClient {
    if (prisma === undefined) throw new Error('El cliente de Prisma no se creó en beforeAll')
    return prisma
  }

  /** El `password_hash` del admin semilla. */
  async function adminHash(): Promise<string> {
    const admin = await db().user.findUniqueOrThrow({ where: { email: SEED_ADMIN.email } })
    return admin.passwordHash
  }

  beforeAll(async () => {
    containers = await startContainers()
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: containers.databaseUrl }),
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    await containers?.stop()
  })

  it('dos corridas seguidas dejan los mismos conteos (idempotente)', async () => {
    const first = await seed(db())
    const afterFirst = await countAll(db())
    const hashAfterFirst = await adminHash()
    const second = await seed(db())
    const afterSecond = await countAll(db())

    expect(first).toEqual({
      categories: 6,
      products: 27,
      reviews: 15,
      contentBlocks: 7,
      users: 1,
    })
    expect(second).toEqual(first)
    expect(afterSecond).toEqual(afterFirst)
    // argon2 sala cada hash: si la segunda corrida lo hubiera recalculado, sería distinto.
    expect(await adminHash()).toBe(hashAfterFirst)
    expect(afterFirst).toMatchObject({
      categories: 6,
      products: 27,
      published: 27,
      inventory: 27,
      reviews: 15,
      contentBlocks: 7,
      settings: 1,
      shippingOptions: 3,
      users: 1,
    })
  })

  it('guarda el catálogo del diseño: grupos, fotos, stock y códigos', async () => {
    const groups = await db().product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    })
    const categories = await db().category.findMany({ orderBy: { position: 'asc' } })
    const byGroup = { mate: 0, bombilla: 0, yerba: 0 }
    for (const row of groups) {
      const category = categories.find((c) => c.id === row.categoryId)
      if (category !== undefined) byGroup[category.group] += row._count._all
    }
    expect(byGroup).toEqual({ mate: 16, bombilla: 8, yerba: 3 })
    expect(categories.map((c) => c.slug)).toEqual([
      'imperiales',
      'torpedos',
      'camioneros',
      'ranchero',
      'bombillones',
      'yerbas',
    ])

    const premium = await db().product.findUniqueOrThrow({
      where: { slug: 'mate-imperial-premium' },
      include: { images: { include: { mediaAsset: true }, orderBy: { position: 'asc' } } },
    })
    expect(premium).toMatchObject({ sequence: 1, priceArs: 39999, featured: true })
    expect(premium.publishedAt).not.toBeNull()
    expect(premium.images.map((i) => i.position)).toEqual([1, 2])
    expect(premium.images[0]?.mediaAsset).toMatchObject({
      provider: 'local',
      url: '/mock-images/mate-imperial-premium.jpg',
      width: 960,
      height: 1280,
    })
    // La foto de la línea Imperiales es la misma que la principal del Premium: un solo asset.
    expect(categories[0]?.imageId).toBe(premium.images[0]?.mediaAssetId)

    const stock = await db().inventory.findMany({ select: { onHand: true, reserved: true } })
    expect(stock.filter((s) => s.onHand === 0)).toHaveLength(1)
    expect(stock.every((s) => s.reserved === 0)).toBe(true)
    expect(await db().product.count({ where: { priceArs: null } })).toBe(1)

    // El seed inserta `sequence` explícitos: el próximo alta sigue en 28, sin chocar.
    const next = await db().product.create({
      data: {
        slug: 'producto-nuevo',
        categoryId: premium.categoryId,
        name: 'Producto nuevo',
        description: 'D',
      },
    })
    expect(next.sequence).toBe(28)
    await db().product.delete({ where: { id: next.id } })
  })

  it('guarda reseñas, contenidos, ajustes y envíos', async () => {
    const reviews = await db().review.findMany()
    expect(reviews.filter((r) => r.featured)).toHaveLength(5)
    expect(reviews.every((r) => r.status === 'approved')).toBe(true)
    expect(reviews.every((r) => r.verifiedPurchase)).toBe(true)
    expect(reviews.some((r) => r.rating.toString() === '4.5')).toBe(true)

    const keys = (await db().contentBlock.findMany({ orderBy: { key: 'asc' } })).map((c) => c.key)
    expect(keys).toEqual([
      'about',
      'faq',
      'footer',
      'home',
      'legal-privacy',
      'legal-terms',
      'product-tabs',
    ])

    const settings = await db().settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings).toMatchObject({ kitDiscountPercent: 10, installmentsMax: 3 })
    expect(settings.vatRatePercent.toString()).toBe('21')

    const shipping = await db().shippingOption.findMany({ orderBy: { method: 'asc' } })
    expect(shipping.map((o) => [o.method, o.costArs])).toEqual([
      ['home', 6500],
      ['branch', 4900],
      ['pickup', 0],
    ])
  })

  it('siembra el admin con argon2id y deja en null los vínculos de reseñas y contenidos', async () => {
    const admin = await db().user.findUniqueOrThrow({ where: { email: SEED_ADMIN.email } })
    expect(admin).toMatchObject({
      email: 'admin@galponmates.com.ar',
      role: 'admin',
      status: 'active',
      lastLoginAt: null,
    })
    expect(admin.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/)
    expect(await verify(admin.passwordHash, 'galpon-demo-2026')).toBe(true)
    expect(await db().customer.count()).toBe(0)

    expect(await db().review.count({ where: { customerId: { not: null } } })).toBe(0)
    expect(await db().contentBlock.count({ where: { updatedBy: { not: null } } })).toBe(0)
  })

  it('una nueva corrida no pisa la contraseña que se cambió desde el panel', async () => {
    const changed = await hash('otra-clave-2026', { type: argon2id })
    await db().user.update({
      where: { email: SEED_ADMIN.email },
      data: { passwordHash: changed },
    })

    await expect(seed(db())).resolves.toMatchObject({ users: 1 })

    expect(await adminHash()).toBe(changed)
    expect(await db().user.count()).toBe(1)
  })

  it('una nueva corrida no baja el stock por debajo de lo reservado y lo avisa', async () => {
    const productId = async (slug: string): Promise<string> =>
      (await db().product.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id
    const premium = await productId('mate-imperial-premium')
    const torpedo = await productId('mate-torpedo-premium')
    // Los dos traen `onHand` 12 en el diseño.
    await db().inventory.update({ where: { productId: premium }, data: { onHand: 5, reserved: 5 } })
    await db().inventory.update({
      where: { productId: torpedo },
      data: { onHand: 20, reserved: 20 },
    })

    const chunks: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    })
    try {
      await expect(seed(db())).resolves.toMatchObject({ products: 27 })
    } finally {
      write.mockRestore()
    }
    const printed = chunks.join('')

    expect(await db().inventory.findUniqueOrThrow({ where: { productId: premium } })).toMatchObject(
      { onHand: 12, reserved: 5 },
    )
    expect(await db().inventory.findUniqueOrThrow({ where: { productId: torpedo } })).toMatchObject(
      { onHand: 20, reserved: 20 },
    )
    expect(printed).toContain('mate-torpedo-premium')
    expect(printed).not.toContain('mate-imperial-premium')
  })
})
