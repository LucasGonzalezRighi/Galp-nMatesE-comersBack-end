import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import {
  createPaymentsHarness,
  type PaymentsHarness,
  signWebhook,
} from '../../../../test/support/payments'
import { ReceiveWebhookCommand } from '../application/commands/receive-webhook.command'
import { WebhooksController } from './webhooks.controller'

/** `x-request-id` de las notificaciones de prueba. */
const REQUEST_ID = '4a1b9d7e-6f3c-4b0a-8c52-9d1e7f2a3b4c'

/** Cuerpo de una notificación de pago, con los campos de más que manda Mercado Pago. */
function notification(id: string, dataId: string): Record<string, unknown> {
  return {
    id,
    type: 'payment',
    action: 'payment.updated',
    api_version: 'v1',
    live_mode: false,
    user_id: 123456,
    date_created: '2026-11-03T12:00:00.000-03:00',
    data: { id: dataId },
  }
}

/** Cambia el último carácter hexadecimal de la firma. */
function flipLast(signature: string): string {
  return signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0')
}

/** El 401 del contrato. */
const INVALID_SIGNATURE = {
  type: 'invalid_signature',
  title: 'Firma inválida',
  status: 401,
  detail: 'La firma de la notificación no coincide.',
  instance: '/webhooks/mercadopago',
}

describe('WebhooksController (HTTP con ReceiveWebhookCommand sobre dobles en memoria)', () => {
  let harness: PaymentsHarness
  let app: INestApplication<Server> | undefined
  let events = 0

  beforeAll(async () => {
    harness = createPaymentsHarness()
    app = await createControllerApp({
      controllers: [WebhooksController],
      providers: [{ provide: ReceiveWebhookCommand, useValue: harness.receive }],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    harness.settings.webhookSecret = 'secreto-de-prueba'
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  /** Id de evento nuevo para cada notificación. */
  function nextEventId(): string {
    events += 1
    return `evt-${String(events)}`
  }

  function send(
    query: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): request.Test {
    let pending = request(server()).post(`/webhooks/mercadopago${query}`)
    for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value)
    return pending.send(body)
  }

  it('firma válida → 200 sin cuerpo, evento registrado y encolado; los campos de más pasan', async () => {
    const rows = harness.webhookEvents.rows.size
    const response = await send(
      '?data.id=1234567890&type=payment',
      {
        'x-signature': signWebhook({ dataId: '1234567890', requestId: REQUEST_ID }),
        'x-request-id': REQUEST_ID,
      },
      notification(nextEventId(), '1234567890'),
    )

    expect(response.status).toBe(200)
    expect(response.text).toBe('')
    expect(harness.webhookEvents.rows.size).toBe(rows + 1)
    expect(harness.queue.jobs).toHaveLength(rows + 1)
  })

  it('data.id con mayúsculas se firma en minúsculas', async () => {
    const response = await send(
      '?data.id=ABC123&type=payment',
      {
        'x-signature': signWebhook({ dataId: 'ABC123', requestId: REQUEST_ID }),
        'x-request-id': REQUEST_ID,
      },
      notification(nextEventId(), 'ABC123'),
    )

    expect(response.status).toBe(200)
  })

  it('x-signature con espacios alrededor de "," y "=" se parsea igual', async () => {
    const [ts = '', v1 = ''] = signWebhook({ dataId: '555', requestId: REQUEST_ID })
      .split(',')
      .map((part) => part.split('=')[1] ?? '')

    const response = await send(
      '?data.id=555&type=payment',
      { 'x-signature': ` ts = ${ts} , v1 = ${v1} `, 'x-request-id': REQUEST_ID },
      notification(nextEventId(), '555'),
    )

    expect(response.status).toBe(200)
  })

  it.each([
    ['v1 cambiado', () => flipLast(signWebhook({ dataId: '777', requestId: REQUEST_ID }))],
    ['sin ts', () => signWebhook({ dataId: '777', requestId: REQUEST_ID }).replace(/^ts=\d+,/, '')],
    [
      'firmada con otro secreto',
      () => signWebhook({ dataId: '777', requestId: REQUEST_ID, secret: 'otro' }),
    ],
  ])('%s → 401 con el cuerpo del contrato, sin filas ni jobs', async (_name, signature) => {
    const rows = harness.webhookEvents.rows.size
    const jobs = harness.queue.jobs.length

    const response = await send(
      '?data.id=777&type=payment',
      { 'x-signature': signature(), 'x-request-id': REQUEST_ID },
      notification(nextEventId(), '777'),
    )

    expect(response.status).toBe(401)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toEqual(INVALID_SIGNATURE)
    expect(harness.webhookEvents.rows.size).toBe(rows)
    expect(harness.queue.jobs).toHaveLength(jobs)
  })

  it('sin x-signature → 401', async () => {
    const response = await send(
      '?data.id=777&type=payment',
      { 'x-request-id': REQUEST_ID },
      notification(nextEventId(), '777'),
    )

    expect(response.status).toBe(401)
    expect(response.body).toEqual(INVALID_SIGNATURE)
  })

  it('sin secreto configurado → 401 aunque la firma "coincida"', async () => {
    harness.settings.webhookSecret = null

    const response = await send(
      '?data.id=777&type=payment',
      {
        'x-signature': signWebhook({ dataId: '777', requestId: REQUEST_ID }),
        'x-request-id': REQUEST_ID,
      },
      notification(nextEventId(), '777'),
    )

    expect(response.status).toBe(401)
    expect(response.body).toEqual(INVALID_SIGNATURE)
  })

  it('formato IPN (?topic=&id=, sin firma) → 200 sin registrar nada', async () => {
    const rows = harness.webhookEvents.rows.size

    const response = await request(server())
      .post('/webhooks/mercadopago?topic=payment&id=1234567890')
      .send({ resource: '1234567890', topic: 'payment' })

    expect(response.status).toBe(200)
    expect(harness.webhookEvents.rows.size).toBe(rows)
  })

  it('el mismo evento dos veces → 200 las dos, una sola fila', async () => {
    const rows = harness.webhookEvents.rows.size
    const id = nextEventId()
    const headers = {
      'x-signature': signWebhook({ dataId: '999', requestId: REQUEST_ID }),
      'x-request-id': REQUEST_ID,
    }

    const first = await send('?data.id=999&type=payment', headers, notification(id, '999'))
    const second = await send('?data.id=999&type=payment', headers, notification(id, '999'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(harness.webhookEvents.rows.size).toBe(rows + 1)
  })
})
