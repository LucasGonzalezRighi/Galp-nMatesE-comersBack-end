import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDomainEvent, type DomainEvent } from '../../src/shared/domain/domain-event'
import {
  OUTBOX_QUEUE,
  OutboxRelay,
  type OutboxJobData,
} from '../../src/shared/infrastructure/outbox/outbox.relay'
import { OutboxRepository } from '../../src/shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

describe('outbox (E2E)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function services(): {
    prisma: PrismaService
    outbox: OutboxRepository
    relay: OutboxRelay
    queue: Queue<OutboxJobData>
  } {
    if (app === undefined) throw new Error('La app no arrancó')
    return {
      prisma: app.get(PrismaService),
      outbox: app.get(OutboxRepository),
      relay: app.get(OutboxRelay),
      queue: app.get<Queue<OutboxJobData>>(getQueueToken(OUTBOX_QUEUE)),
    }
  }

  function orderCreated(number: string): DomainEvent {
    return createDomainEvent(
      {
        type: 'order.created',
        aggregateType: 'order',
        aggregateId: number,
        payload: { number, totalArs: 45_900, items: [{ sku: 'MATE-1', quantity: 2 }] },
      },
      new Date(),
    )
  }

  async function jobsOf(queue: Queue<OutboxJobData>, eventId: string): Promise<number> {
    const jobs = await queue.getJobs()
    return jobs.filter((job) => job.data.id === eventId).length
  }

  it('con NODE_ENV=test el relay no arranca su temporizador', () => {
    expect(Reflect.get(services().relay, 'timer')).toBeUndefined()
  })

  it('append en una transacción y el relay publican un job con el payload del evento', async () => {
    const { prisma, outbox, relay, queue } = services()
    const event = orderCreated('GLP-1001')

    await prisma.$transaction(async (tx) => {
      await outbox.append(tx, event)
    })
    await expect(relay.runOnce()).resolves.toBe(1)

    const job = await queue.getJob(event.id)
    expect(job?.name).toBe('order.created')
    expect(job?.data).toEqual({
      id: event.id,
      type: 'order.created',
      aggregateType: 'order',
      aggregateId: 'GLP-1001',
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })
    expect(job?.opts.attempts).toBe(5)
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 1_000 })

    const row = await prisma.outboxEvent.findUnique({ where: { id: event.id } })
    expect(row?.publishedAt).toBeInstanceOf(Date)
    await expect(relay.runOnce()).resolves.toBe(0)
  })

  it('un segundo append del mismo id no duplica el evento ni el job', async () => {
    const { prisma, outbox, relay, queue } = services()
    const event = orderCreated('GLP-1002')

    await prisma.$transaction(async (tx) => {
      await outbox.append(tx, event)
    })
    await prisma.$transaction(async (tx) => {
      await outbox.append(tx, event)
    })
    expect(await prisma.outboxEvent.count({ where: { id: event.id } })).toBe(1)
    await relay.runOnce()

    // Aunque se vuelva a publicar (por ejemplo, si se cayó antes de marcar published_at), el
    // jobId evita el duplicado en la cola.
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: null } })
    await relay.runOnce()

    expect(await jobsOf(queue, event.id)).toBe(1)
  })

  it('si la transacción se revierte, el evento no queda en el outbox', async () => {
    const { prisma, outbox } = services()
    const event = orderCreated('GLP-1003')

    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.append(tx, event)
        throw new Error('falló el pedido')
      }),
    ).rejects.toThrow('falló el pedido')

    expect(await prisma.outboxEvent.count({ where: { id: event.id } })).toBe(0)
  })
})
