import { PrismaPg } from '@prisma/adapter-pg'
import { argon2id, hash, verify } from 'argon2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { comboSeedId, isDatabaseEmpty, seed, seedIfEmpty } from '../../prisma/seed'
import { SEED_ADMIN, seedAdminCredentials } from '../../prisma/seed-data/admin'
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
  const [contentBlocks, settings, shippingOptions, users, combos, comboItems] = await Promise.all([
    db.contentBlock.count(),
    db.settings.count(),
    db.shippingOption.count(),
    db.user.count(),
    db.combo.count(),
    db.comboItem.count(),
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
    combos,
    comboItems,
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

  it('--if-empty: una base con un admin y sin productos no está vacía y no se siembra', async () => {
    expect(await isDatabaseEmpty(db())).toBe(true)
    // Como queda después de `npm run admin:password` en una base recién migrada.
    const admin = await db().user.create({
      data: { email: 'ya-estaba@galponmates.com.ar', passwordHash: 'x', role: 'admin' },
    })
    try {
      expect(await isDatabaseEmpty(db())).toBe(false)
      await expect(seedIfEmpty(db(), { NODE_ENV: 'test' })).resolves.toBeNull()
      expect(await db().product.count()).toBe(0)
    } finally {
      await db().user.delete({ where: { id: admin.id } })
    }
    expect(await isDatabaseEmpty(db())).toBe(true)
  })

  it('--if-empty: con la base vacía siembra como el seed de siempre (en producción exige las credenciales del admin)', async () => {
    // Vacía y en producción sin credenciales: falla como el seed de siempre y no deja nada.
    await expect(seedIfEmpty(db(), { NODE_ENV: 'production' })).rejects.toThrow(
      'En producción el seed necesita ADMIN_EMAIL y ADMIN_PASSWORD',
    )
    expect(await isDatabaseEmpty(db())).toBe(true)

    const summary = await seedIfEmpty(db(), { NODE_ENV: 'test' })

    expect(summary).toEqual({
      categories: 6,
      products: 27,
      reviews: 18,
      contentBlocks: 9,
      combos: 5,
      users: 1,
    })
    expect(await isDatabaseEmpty(db())).toBe(false)
    expect(await db().product.count()).toBe(27)
    expect(await db().user.count({ where: { role: 'admin', email: SEED_ADMIN.email } })).toBe(1)
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
      reviews: 18,
      contentBlocks: 9,
      combos: 5,
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
      reviews: 18,
      contentBlocks: 9,
      settings: 1,
      shippingOptions: 3,
      users: 1,
      combos: 5,
      comboItems: 11,
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
    // Los cueros del diseño: los 16 mates con los cuatro y las bombillas y las yerbas sin ninguno.
    const withLeathers = await db().product.findMany({
      select: { leathers: true, category: { select: { group: true } } },
    })
    const leathersOf = (group: string): string[][] =>
      withLeathers.filter((p) => p.category.group === group).map((p) => p.leathers)
    expect(leathersOf('mate')).toEqual(
      Array.from({ length: 16 }, () => ['Negro', 'Marrón', 'Crudo', 'Borravino']),
    )
    expect(leathersOf('bombilla')).toEqual(Array.from({ length: 8 }, () => []))
    expect(leathersOf('yerba')).toEqual(Array.from({ length: 3 }, () => []))
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
    // El texto alternativo es por uso: cada foto del producto y la de la línea guardan el suyo.
    expect(premium.images.map((i) => i.alt)).toEqual(premium.images.map((i) => i.mediaAsset.alt))
    expect(categories[0]?.imageAlt).toBe(
      'Calabaza marrón oscura con virola ancha plateada cincelada con rombos y base de patas con pelotitas doradas',
    )
    expect(categories.slice(1).every((c) => c.imageAlt === null)).toBe(true)

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
    expect(reviews.filter((r) => r.featured)).toHaveLength(10)
    expect(reviews.every((r) => r.status === 'approved')).toBe(true)
    expect(reviews.every((r) => r.verifiedPurchase)).toBe(true)
    expect(reviews.some((r) => r.rating.toString() === '4.5')).toBe(true)

    const keys = (await db().contentBlock.findMany({ orderBy: { key: 'asc' } })).map((c) => c.key)
    expect(keys).toEqual([
      'about',
      'faq',
      'footer',
      'home',
      'legal-cookies',
      'legal-privacy',
      'legal-returns',
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

  it('guarda los combos del diseño por posición, con sus piezas en el orden del combo', async () => {
    const combos = await db().combo.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { items: { orderBy: { position: 'asc' }, include: { product: true } } },
    })
    expect(combos.map((c) => [c.position, c.name, c.status, c.priceArs])).toEqual([
      [1, 'Dúo Imperial', 'published', 61999],
      [2, 'Camionero y Canarias', 'published', 31499],
      [3, 'Torpedo completo', 'published', 67999],
      [4, 'Bombilla y yerba', 'published', 34999],
      [5, 'Galleta y Canarias', 'draft', 33999],
    ])
    expect(combos[0]?.id).toBe(comboSeedId({ key: 'cmb-duo-imperial' }))
    expect(combos[4]?.id).toBe(comboSeedId({ key: 'cmb-galleta-y-canarias' }))

    const torpedo = combos.find((c) => c.name === 'Torpedo completo')
    expect(torpedo?.items.map((i) => [i.position, i.product.slug])).toEqual([
      [1, 'mate-torpedo-virola-de-alpaca-cincelada'],
      [2, 'bombillon-100-alpaca'],
      [3, 'yerba-canarias-serena-1-kg'],
    ])
    const galleta = combos.find((c) => c.name === 'Galleta y Canarias')
    expect(galleta?.items.map((i) => i.product.slug)).toEqual([
      'mate-galleta',
      'yerba-canarias-1-kg',
    ])
  })

  it('una nueva corrida repone los combos del diseño y no toca los del dashboard', async () => {
    const duoId = comboSeedId({ key: 'cmb-duo-imperial' })
    const yerba = await db().product.findUniqueOrThrow({ where: { slug: 'yerba-canarias-1-kg' } })
    const mate = await db().product.findUniqueOrThrow({ where: { slug: 'mate-galleta' } })
    await db().combo.update({ where: { id: duoId }, data: { name: 'Otro nombre', position: 9 } })
    await db().comboItem.deleteMany({ where: { comboId: duoId, position: 2 } })
    const own = await db().combo.create({
      data: {
        name: 'Combo del dashboard',
        description: 'Creado a mano',
        priceArs: 30000,
        status: 'published',
        position: 6,
        items: {
          create: [
            { position: 1, productId: yerba.id },
            { position: 2, productId: mate.id },
          ],
        },
      },
    })

    await expect(seed(db())).resolves.toMatchObject({ combos: 5 })

    const duo = await db().combo.findUniqueOrThrow({
      where: { id: duoId },
      include: { items: { orderBy: { position: 'asc' }, include: { product: true } } },
    })
    expect(duo).toMatchObject({ name: 'Dúo Imperial', position: 1 })
    expect(duo.items.map((i) => i.product.slug)).toEqual([
      'mate-imperial-premium',
      'bombillon-premium-curvo',
    ])
    const kept = await db().combo.findUniqueOrThrow({
      where: { id: own.id },
      include: { items: { orderBy: { position: 'asc' } } },
    })
    expect(kept).toMatchObject({ name: 'Combo del dashboard', position: 6 })
    expect(kept.items.map((i) => i.productId)).toEqual([yerba.id, mate.id])
    await db().combo.delete({ where: { id: own.id } })
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

  it('con credenciales propias crea ese admin y no el de demostración (NV-10)', async () => {
    const own = { email: 'duena@galponmates.com.ar', password: 'una-clave-larga-2026' }

    try {
      await expect(seed(db(), own)).resolves.toMatchObject({ users: 1 })

      const created = await db().user.findUniqueOrThrow({ where: { email: own.email } })
      expect(created).toMatchObject({ role: 'admin', status: 'active' })
      expect(await verify(created.passwordHash, own.password)).toBe(true)
    } finally {
      await db().user.deleteMany({ where: { email: own.email } })
    }
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

  it('una nueva corrida no pisa los contenidos, los ajustes ni los envíos guardados desde el panel', async () => {
    const home = await db().contentBlock.findUniqueOrThrow({ where: { key: 'home' } })
    const editedHome = { ...(home.data as Record<string, unknown>), editedFromPanel: true }
    await db().contentBlock.update({
      where: { key: 'home' },
      data: { data: editedHome, version: 2 },
    })
    const consumerLinks = {
      cabaUrl: 'https://caba.example/',
      nationalUrl: 'https://nacion.example/',
    }
    await db().settings.update({
      where: { id: 1 },
      data: { kitDiscountPercent: 15, version: 2, consumerLinks },
    })
    // Una base sembrada antes de B7: le faltan los documentos de cookies y de devoluciones.
    await db().contentBlock.deleteMany({
      where: { key: { in: ['legal-cookies', 'legal-returns'] } },
    })
    await db().shippingOption.update({
      where: { method: 'home' },
      data: { costArs: 7000, enabled: false },
    })

    await expect(seed(db())).resolves.toMatchObject({ contentBlocks: 9 })

    expect(await db().contentBlock.findUniqueOrThrow({ where: { key: 'home' } })).toMatchObject({
      data: editedHome,
      version: 2,
    })
    expect(await db().settings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      kitDiscountPercent: 15,
      version: 2,
      consumerLinks,
    })
    const legal = await db().contentBlock.findMany({
      where: { key: { in: ['legal-cookies', 'legal-returns'] } },
      orderBy: { key: 'asc' },
    })
    expect(legal.map(({ key, data }) => [key, (data as { title: string }).title])).toEqual([
      ['legal-cookies', 'Política de cookies'],
      ['legal-returns', 'Cambios, devoluciones y arrepentimiento'],
    ])
    expect(
      await db().shippingOption.findUniqueOrThrow({ where: { method: 'home' } }),
    ).toMatchObject({ costArs: 7000, enabled: false })
  })

  it('un producto renombrado desde el panel vuelve al slug del diseño sin duplicarse ni fallar', async () => {
    const before = await countAll(db())
    const galleta = await db().product.findUniqueOrThrow({ where: { slug: 'mate-galleta' } })
    // Como el dashboard: el slug anterior pasa al historial del producto.
    await db().product.update({
      where: { id: galleta.id },
      data: { slug: 'mate-galleta-renovado', name: 'Mate Galleta Renovado' },
    })
    await db().productSlugHistory.create({ data: { slug: 'mate-galleta', productId: galleta.id } })

    await expect(seed(db())).resolves.toMatchObject({ products: 27 })

    expect(await countAll(db())).toEqual(before)
    expect(await db().product.findUniqueOrThrow({ where: { id: galleta.id } })).toMatchObject({
      sequence: galleta.sequence,
      slug: 'mate-galleta',
      name: galleta.name,
    })
    const history = await db().productSlugHistory.findMany({ where: { productId: galleta.id } })
    expect(history.map((h) => h.slug)).toEqual(['mate-galleta-renovado'])
  })

  it('--if-empty: con la base ya sembrada no toca nada, ni un producto renombrado desde el panel, y no pide las credenciales del admin', async () => {
    const galleta = await db().product.findUniqueOrThrow({ where: { slug: 'mate-galleta' } })
    // Como el dashboard: el slug anterior pasa al historial del producto.
    const renamed = await db().product.update({
      where: { id: galleta.id },
      data: { slug: 'mate-galleta-del-panel', name: 'Mate Galleta del panel' },
    })
    await db().productSlugHistory.create({ data: { slug: 'mate-galleta', productId: galleta.id } })
    const slugHistory = async (): Promise<string[]> =>
      (
        await db().productSlugHistory.findMany({
          where: { productId: galleta.id },
          orderBy: { slug: 'asc' },
        })
      ).map((h) => h.slug)
    const before = await countAll(db())
    const historyBefore = await slugHistory()
    const hashBefore = await adminHash()

    // Producción sin ADMIN_EMAIL ni ADMIN_PASSWORD: el seed de siempre ni arrancaría.
    const summary = await seedIfEmpty(db(), { NODE_ENV: 'production' })

    expect(summary).toBeNull()
    expect(await isDatabaseEmpty(db())).toBe(false)
    expect(await countAll(db())).toEqual(before)
    expect(await adminHash()).toBe(hashBefore)
    // Ni siquiera lo reescribe: la fila queda con el `updatedAt` del cambio del panel.
    expect(await db().product.findUniqueOrThrow({ where: { id: galleta.id } })).toEqual(renamed)
    expect(await slugHistory()).toEqual(historyBefore)
    expect(historyBefore).toContain('mate-galleta')
  })
})

describe('seedAdminCredentials (sin base, NV-10)', () => {
  /** Credenciales propias válidas para producción. */
  const OWN = { ADMIN_EMAIL: ' Duena@GalponMates.com.ar ', ADMIN_PASSWORD: 'una-clave-larga-2026' }

  it('en producción exige ADMIN_EMAIL y ADMIN_PASSWORD propios y falla si faltan', () => {
    expect(() => seedAdminCredentials({ NODE_ENV: 'production' })).toThrow(
      'En producción el seed necesita ADMIN_EMAIL y ADMIN_PASSWORD (12 caracteres o más, distinta de la de demostración).',
    )
    expect(() =>
      seedAdminCredentials({ NODE_ENV: 'production', ADMIN_EMAIL: OWN.ADMIN_EMAIL }),
    ).toThrow('ADMIN_PASSWORD')
    expect(() =>
      seedAdminCredentials({ NODE_ENV: 'production', ADMIN_PASSWORD: OWN.ADMIN_PASSWORD }),
    ).toThrow('ADMIN_EMAIL')
  })

  it('en producción rechaza una contraseña corta o la de demostración, sin mostrarla', () => {
    const short = (): unknown =>
      seedAdminCredentials({ ...OWN, NODE_ENV: 'production', ADMIN_PASSWORD: 'corta-2026' })
    const demo = (): unknown =>
      seedAdminCredentials({ ...OWN, NODE_ENV: 'production', ADMIN_PASSWORD: SEED_ADMIN.password })

    expect(short).toThrow('12 caracteres o más')
    expect(short).not.toThrow('corta-2026')
    expect(demo).toThrow('distinta de la de demostración')
    expect(demo).not.toThrow(SEED_ADMIN.password)
  })

  it('en producción con las dos variables usa esas, con el email normalizado', () => {
    expect(seedAdminCredentials({ ...OWN, NODE_ENV: 'production' })).toEqual({
      email: 'duena@galponmates.com.ar',
      password: 'una-clave-larga-2026',
    })
  })

  it('fuera de producción usa la de demostración si no vienen otras', () => {
    expect(seedAdminCredentials({ NODE_ENV: 'development' })).toEqual(SEED_ADMIN)
    expect(seedAdminCredentials({ NODE_ENV: 'test' })).toEqual(SEED_ADMIN)
    expect(seedAdminCredentials({ ...OWN, NODE_ENV: 'development' })).toEqual({
      email: 'duena@galponmates.com.ar',
      password: 'una-clave-larga-2026',
    })
  })

  it('sin NODE_ENV (o con uno desconocido) no corre', () => {
    expect(() => seedAdminCredentials({})).toThrow(
      'NODE_ENV tiene que ser development, test o production',
    )
    expect(() => seedAdminCredentials({ NODE_ENV: 'prod' })).toThrow('NODE_ENV')
  })
})

describe('comboSeedId (sin base)', () => {
  it('es un UUID v5 fijo por clave', () => {
    const id = comboSeedId({ key: 'cmb-duo-imperial' })

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(comboSeedId({ key: 'cmb-duo-imperial' })).toBe(id)
    expect(comboSeedId({ key: 'cmb-torpedo-completo' })).not.toBe(id)
  })

  it.each(['', '   '])('con la clave %j lanza un TypeError en español', (key) => {
    expect(() => comboSeedId({ key })).toThrow(TypeError)
    expect(() => comboSeedId({ key })).toThrow('La clave del combo del seed no puede estar vacía')
  })
})
