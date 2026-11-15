import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createDomainEvent,
  type DomainEvent,
  type JsonObject,
} from '../../src/shared/domain/domain-event'
import {
  OUTBOX_QUEUE,
  OutboxRelay,
  type OutboxJobData,
} from '../../src/shared/infrastructure/outbox/outbox.relay'
import { OutboxHandlerRegistry } from '../../src/shared/infrastructure/outbox/outbox-handler.registry'
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

  function registry(): OutboxHandlerRegistry {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(OutboxHandlerRegistry)
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

  /** Espera de la cola: el worker toma el job en milisegundos, pero Docker puede ir lento. */
  const QUEUE_WAIT = { timeout: 15_000, interval: 100 } as const

  function event(type: string, payload: JsonObject): DomainEvent {
    return createDomainEvent(
      { type, aggregateType: 'order', aggregateId: 'o1', payload },
      new Date(),
    )
  }

  async function saved(domainEvent: DomainEvent): Promise<void> {
    const { prisma, outbox } = services()
    await prisma.$transaction(async (tx) => {
      await outbox.append(tx, domainEvent)
    })
  }

  /** Datos del job que publica el relay para un evento. */
  function jobData(domainEvent: DomainEvent): OutboxJobData {
    return {
      id: domainEvent.id,
      type: domainEvent.type,
      aggregateType: domainEvent.aggregateType,
      aggregateId: domainEvent.aggregateId,
      occurredAt: domainEvent.occurredAt.toISOString(),
      payload: domainEvent.payload,
    }
  }

  /** Espera a que el job termine (completo o fallido) y devuelve su estado. */
  async function settled(queue: Queue<OutboxJobData>, jobId: string): Promise<string> {
    return vi.waitFor(async () => {
      const state = await (await queue.getJob(jobId))?.getState()
      expect(['completed', 'failed']).toContain(state)
      return state ?? ''
    }, QUEUE_WAIT)
  }

  it('NV-27: un job que no coincide con el evento guardado no llega a los handlers', async () => {
    const { queue } = services()
    const seen: unknown[] = []
    registry().register('test.nv27', {
      handle: (data) => {
        seen.push(data.payload)
        return Promise.resolve()
      },
    })
    const real = event('test.nv27', { orderId: 'pedido-vencido' })
    await saved(real)
    const forgedId = event('test.nv27', { orderId: 'pedido-pagado' })

    // Alguien con acceso a Redis: otro pedido con el id real, y un evento que no existe.
    await queue.add(
      'test.nv27',
      { ...jobData(real), payload: { orderId: 'pedido-pagado' } },
      {
        jobId: `${real.id}-falso`,
      },
    )
    await queue.add('test.nv27', jobData(forgedId), { jobId: forgedId.id })
    await queue.add('test.nv27', jobData(real), { jobId: real.id })

    expect(await settled(queue, `${real.id}-falso`)).toBe('completed')
    expect(await settled(queue, forgedId.id)).toBe('completed')
    expect(await settled(queue, real.id)).toBe('completed')
    expect(seen).toEqual([{ orderId: 'pedido-vencido' }])
  })

  it('NV-29: si el despacho agota los reintentos, el evento vuelve a quedar pendiente con espera', async () => {
    const { prisma, relay, queue } = services()
    let calls = 0
    registry().register('test.nv29', {
      handle: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('Postgres caído')) : Promise.resolve()
      },
    })
    const failing = event('test.nv29', { orderId: 'o1' })
    await saved(failing)
    // Como el relay, pero con un solo intento para no esperar el backoff de BullMQ.
    await queue.add(failing.type, jobData(failing), { jobId: failing.id, attempts: 1 })
    await prisma.outboxEvent.update({
      where: { id: failing.id },
      data: { publishedAt: new Date() },
    })
    expect(await settled(queue, failing.id)).toBe('failed')

    const reopened = await vi.waitFor(async () => {
      const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failing.id } })
      expect(row.publishedAt).toBeNull()
      return row
    }, QUEUE_WAIT)
    expect(reopened.dispatchFailures).toBe(1)
    expect(reopened.availableAt?.getTime()).toBeGreaterThan(Date.now() + 30_000)
    // Antes de su espera, el relay no lo toma.
    await relay.runOnce()
    expect(await queue.getJob(`${failing.id}-r1`)).toBeUndefined()

    await prisma.outboxEvent.update({
      where: { id: failing.id },
      data: { availableAt: new Date(Date.now() - 1_000) },
    })
    await relay.runOnce()
    expect(await settled(queue, `${failing.id}-r1`)).toBe('completed')
    expect(calls).toBe(2)
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failing.id } })
    expect(row.publishedAt).toBeInstanceOf(Date)
  })
})
