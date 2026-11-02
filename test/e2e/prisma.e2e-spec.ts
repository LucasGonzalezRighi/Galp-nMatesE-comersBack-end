import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

describe('prisma', () => {
  let containers: TestContainers | undefined
  let app: INestApplication | undefined

  /** El `PrismaService` de la app; falla claro si `beforeAll` no llegó a crearla. */
  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no se creó en beforeAll')
    return app.get(PrismaService)
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
  })

  it('se conecta a la base migrada y vacía', async () => {
    expect(await prisma().category.count()).toBe(0)
    expect(await prisma().$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }])
  })

  it('la migración crea la extensión citext y el índice parcial del outbox', async () => {
    const extensions = await prisma().$queryRaw<
      { extname: string }[]
    >`SELECT extname FROM pg_extension WHERE extname = 'citext'`
    expect(extensions).toHaveLength(1)

    const indexes = await prisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'outbox_events'
        AND indexdef LIKE '%WHERE (published_at IS NULL)%'`
    expect(indexes).toHaveLength(1)
  })

  it('los CHECK escritos a mano rechazan stock, puntajes y ajustes inválidos', async () => {
    const db = prisma()
    const category = await db.category.create({
      data: { slug: 'imperiales', name: 'Imperiales', group: 'mate', blurb: 'B', position: 1 },
    })
    const product = await db.product.create({
      data: { slug: 'mate-x', categoryId: category.id, name: 'Mate X', description: 'D' },
    })
    const productId = product.id

    await expect(
      db.inventory.create({ data: { productId, onHand: 1, reserved: 2 } }),
    ).rejects.toThrow(/inventory_reserved_check/)
    await expect(
      db.inventory.create({ data: { productId, onHand: 1, reserved: -1 } }),
    ).rejects.toThrow(/inventory_reserved_check/)
    await expect(
      db.inventory.create({ data: { productId, onHand: 2, reserved: 2 } }),
    ).resolves.toMatchObject({ onHand: 2, reserved: 2, version: 0 })

    const review = { productId, authorName: 'Martina R.', text: 'Muy lindo' }
    for (const rating of [0.5, 4.3, 5.5]) {
      await expect(db.review.create({ data: { ...review, rating } })).rejects.toThrow(
        /reviews_rating_check/,
      )
    }
    const half = await db.review.create({ data: { ...review, rating: 4.5 } })
    expect(half.rating.toString()).toBe('4.5')
    expect(half.status).toBe('pending')

    const settings = {
      kitDiscountPercent: 10,
      installmentsMax: 3,
      installmentsShowOnProduct: true,
      contactEmail: 'galpon.mates@gmail.com',
      lowStockThreshold: 3,
      vatRatePercent: 10.5,
      showNetPrice: true,
      seller: { legalName: null },
    }
    await expect(db.settings.create({ data: { ...settings, id: 2 } })).rejects.toThrow(
      /settings_singleton_check/,
    )
    const saved = await db.settings.create({ data: settings })
    expect(saved.id).toBe(1)
    expect(saved.vatRatePercent.toString()).toBe('10.5')

    const second = await db.product.create({
      data: { slug: 'mate-y', categoryId: category.id, name: 'Mate Y', description: 'D' },
    })
    expect(second.sequence).toBe(product.sequence + 1)
  })
})
