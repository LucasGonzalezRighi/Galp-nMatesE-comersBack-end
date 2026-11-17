import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { PrivacyPurgeSweep } from '../../src/modules/privacy/infrastructure/privacy-purge.sweep'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { FixedClock } from '../support/clock'
import { startContainers, type TestContainers } from '../support/containers'

const NOW = new Date('2026-11-17T12:00:00.000Z')
const HOUR = 60 * 60 * 1_000
const DAY = 24 * HOUR

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

function monthsAgo(months: number): Date {
  const date = new Date(NOW)
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

describe('purga de datos personales (Postgres)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ clock: new FixedClock(NOW) })
    await seed(app.get(PrismaService))
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  it('customers ya no tiene document_type ni document_number', async () => {
    const columns = await prisma().$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'customers' AND column_name LIKE 'document%'`
    expect(columns).toEqual([])
  })

  it('Review Focus 4: borra lo vencido y deja pedidos, arrepentimientos, reseñas aprobadas y lo reciente', async () => {
    const db = prisma()
    const product = await db.product.findFirstOrThrow({ select: { id: true } })
    const user = await db.user.findFirstOrThrow({ select: { id: true } })

    const order = await db.order.create({
      data: {
        number: 'GLP-90001',
        paymentMethod: 'mp_redirect',
        contactEmail: 'vieja@example.com',
        contactFirstName: 'Ana',
        contactLastName: 'Vieja',
        shippingMethod: 'home',
        shippingCostArs: 0,
        shippingEta: '3 a 6 días',
        itemsGrossArs: 1000,
        kitSavingsArs: 0,
        subtotalArs: 1000,
        totalArs: 1000,
        kitDiscountPercent: 0,
        accessTokenHash: 'hash-del-pedido-viejo',
        reservedUntil: monthsAgo(108),
        placedAt: monthsAgo(108),
        createdAt: monthsAgo(108),
      },
    })
    const review = (status: 'pending' | 'approved' | 'hidden', createdAt: Date, text: string) =>
      db.review.create({
        data: { productId: product.id, authorName: 'Ana', rating: 5, text, status, createdAt },
      })
    await review('approved', monthsAgo(60), 'aprobada vieja')
    await review('hidden', monthsAgo(13), 'rechazada de 13 meses')
    await review('pending', monthsAgo(11), 'pendiente de 11 meses')
    const idempotency = (key: string, createdAt: Date) =>
      db.idempotencyKey.create({
        data: {
          scope: 'POST /orders',
          key,
          requestHash: 'h',
          status: 'completed',
          expiresAt: new Date(createdAt.getTime() + DAY),
          createdAt,
        },
      })
    await idempotency('clave-47h', ago(47 * HOUR))
    await idempotency('clave-49h', ago(49 * HOUR))
    const contact = (createdAt: Date, name: string) =>
      db.contactMessage.create({
        data: {
          kind: 'contact',
          name,
          email: 'ana@example.com',
          reason: 'otro',
          message: 'Hola',
          createdAt,
        },
      })
    await contact(monthsAgo(25), 'contacto de 25 meses')
    await contact(monthsAgo(23), 'contacto de 23 meses')
    await db.contactMessage.create({
      data: {
        kind: 'withdrawal',
        name: 'arrepentimiento viejo',
        email: 'ana@example.com',
        code: 'ARR-000001',
        createdAt: monthsAgo(60),
      },
    })
    const token = (tokenHash: string, expiresAt: Date) =>
      db.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
    await token('vencido-hace-8-dias', ago(8 * DAY))
    await token('vencido-hace-6-dias', ago(6 * DAY))
    const webhook = (eventId: string, processedAt: Date | null) =>
      db.webhookEvent.create({
        data: {
          provider: 'mercadopago',
          eventId,
          type: 'payment',
          signatureValid: true,
          payload: {},
          receivedAt: ago(200 * DAY),
          processedAt,
        },
      })
    await webhook('procesado-91', ago(91 * DAY))
    await webhook('procesado-89', ago(89 * DAY))
    await webhook('sin-procesar', null)
    const outbox = (aggregateId: string, publishedAt: Date | null) =>
      db.outboxEvent.create({
        data: {
          aggregateType: 'order',
          aggregateId,
          type: 'order.paid',
          payload: {},
          occurredAt: ago(200 * DAY),
          publishedAt,
        },
      })
    await outbox('publicado-91', ago(91 * DAY))
    await outbox('publicado-89', ago(89 * DAY))
    await outbox('sin-publicar', null)
    const sweep = app?.get(PrivacyPurgeSweep)
    if (sweep === undefined) throw new Error('La app no arrancó')

    const summary = await sweep.runOnce()

    expect(summary).toEqual({
      idempotencyKeys: 1,
      passwordResetTokens: 1,
      contactMessages: 1,
      webhookEvents: 1,
      outboxEvents: 1,
      reviews: 1,
    })
    expect(await db.order.count({ where: { id: order.id } })).toBe(1)
    expect(
      (
        await db.review.findMany({
          where: {
            text: { in: ['aprobada vieja', 'rechazada de 13 meses', 'pendiente de 11 meses'] },
          },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.text),
    ).toEqual(['aprobada vieja', 'pendiente de 11 meses'])
    expect((await db.idempotencyKey.findMany()).map((row) => row.key)).toEqual(['clave-47h'])
    expect(
      (await db.contactMessage.findMany({ orderBy: { createdAt: 'asc' } })).map((row) => row.name),
    ).toEqual(['arrepentimiento viejo', 'contacto de 23 meses'])
    expect((await db.passwordResetToken.findMany()).map((row) => row.tokenHash)).toEqual([
      'vencido-hace-6-dias',
    ])
    expect(
      (await db.webhookEvent.findMany({ orderBy: { eventId: 'asc' } })).map((row) => row.eventId),
    ).toEqual(['procesado-89', 'sin-procesar'])
    expect(
      (await db.outboxEvent.findMany({ where: { aggregateType: 'order' } }))
        .map((row) => row.aggregateId)
        .sort(),
    ).toEqual(['publicado-89', 'sin-publicar'])

    expect(await sweep.runOnce()).toEqual({
      idempotencyKeys: 0,
      passwordResetTokens: 0,
      contactMessages: 0,
      webhookEvents: 0,
      outboxEvents: 0,
      reviews: 0,
    })
  })
})
