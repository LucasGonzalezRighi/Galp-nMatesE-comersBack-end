import type { INestApplication } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import {
  createPaymentsHarness,
  ORDER_TOKEN,
  type PaymentsHarness,
  simToken,
} from '../../../../test/support/payments'
import { CLOCK } from '../../../shared/domain/clock'
import { IdempotencyInterceptor } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '../../../shared/infrastructure/idempotency/idempotency.repository'
import type { OrderStatus } from '../../orders/domain/order-status'
import { CancelPaymentCommand } from '../application/commands/cancel-payment.command'
import { CreatePreferenceCommand } from '../application/commands/create-preference.command'
import { PayWithCardCommand } from '../application/commands/pay-with-card.command'
import { GetInstallmentsQuery } from '../application/queries/get-installments.query'
import { PaymentsController } from './payments.controller'

/** Clave en mayúsculas: la ruta la pasa en minúsculas, como el interceptor. */
const KEY = '3F2B8C1E-5D4A-4E7B-9A60-1C2D3E4F5A6B'

/** Repositorio de idempotencia que siempre deja empezar (el replay real va en el E2E). */
const idempotency: IdempotencyRepository = {
  begin: () => Promise.resolve({ outcome: 'started' }),
  complete: () => Promise.resolve(),
  release: () => Promise.resolve(),
}

/** Cuerpo de `POST …/card` como lo arma la tienda. */
function cardBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: simToken('APRO'),
    paymentMethodId: 'visa',
    issuerId: null,
    installments: 1,
    payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
    ...overrides,
  }
}

/** El cuerpo sin un campo. */
function without(body: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== field))
}

/** El mismo cuerpo con otro documento. */
function withDocument(type: string, number: string): Record<string, unknown> {
  return cardBody({
    payer: { email: 'ana@example.com', identification: { type, number } },
  })
}

describe('PaymentsController (HTTP con los casos de uso sobre dobles en memoria)', () => {
  let harness: PaymentsHarness
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    harness = createPaymentsHarness()
    app = await createControllerApp({
      controllers: [PaymentsController],
      providers: [
        { provide: IDEMPOTENCY_REPOSITORY, useValue: idempotency },
        { provide: CLOCK, useValue: harness.clock },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: CreatePreferenceCommand, useValue: harness.preference },
        { provide: PayWithCardCommand, useValue: harness.card },
        { provide: GetInstallmentsQuery, useValue: harness.installments },
        { provide: CancelPaymentCommand, useValue: harness.cancel },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    harness.gateway.calls.length = 0
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  /** Pedido nuevo en el doble (por defecto `pending_payment`). */
  function order(status: OrderStatus = 'pending_payment') {
    return harness.orders.add({ status })
  }

  type Route = 'preference' | 'card' | 'installments' | 'cancel'

  /**
   * Pega a una de las cuatro rutas con un cuerpo válido y los headers dados; la preferencia y la
   * tarjeta llevan una `Idempotency-Key` nueva salvo que venga en `headers`.
   */
  function post(
    route: Route,
    number: string,
    headers: Record<string, string> = {},
    body?: Record<string, unknown>,
  ): request.Test {
    const path =
      route === 'cancel'
        ? `/orders/${number}/cancel-payment`
        : `/orders/${number}/payments/mercadopago/${route}`
    const keyed = route === 'preference' || route === 'card'
    let pending = request(server()).post(path)
    for (const [name, value] of Object.entries({
      ...(keyed ? { 'Idempotency-Key': randomUUID() } : {}),
      ...headers,
    })) {
      pending = pending.set(name, value)
    }
    const payload =
      body ??
      (route === 'card'
        ? cardBody()
        : route === 'installments'
          ? { bin: '45031234', paymentTypeId: 'credit_card' }
          : undefined)
    return payload === undefined ? pending : pending.send(payload)
  }

  const ROUTES: readonly Route[] = ['preference', 'card', 'installments', 'cancel']

  describe('acceso por X-Order-Token', () => {
    it.each(ROUTES)(
      '%s: sin token, con token ajeno y con un pedido que no existe → el mismo 404, nunca 401',
      async (route) => {
        const { number } = order()
        const responses = await Promise.all([
          post(route, number),
          post(route, number, { 'X-Order-Token': 'otro-token' }),
          post(route, 'GLP-99999', { 'X-Order-Token': ORDER_TOKEN }),
        ])

        for (const response of responses) {
          expect(response.status).toBe(404)
          expect(response.headers['content-type']).toContain('application/problem+json')
          expect(response.body).toMatchObject({
            type: 'not_found',
            title: 'No encontrado',
            status: 404,
            detail: 'No encontramos ese pedido.',
          })
          expect(Object.keys(response.body as object).sort()).toEqual(
            ['detail', 'instance', 'status', 'title', 'type'].sort(),
          )
        }
      },
    )

    it('un número con otro formato → 422 en number', async () => {
      const response = await post('preference', 'GLP-1', { 'X-Order-Token': ORDER_TOKEN })

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        type: 'validation_error',
        errors: [
          {
            field: 'number',
            code: 'invalid_format',
            message: 'El número de pedido tiene que ser GLP- y cinco dígitos.',
          },
        ],
      })
    })
  })

  describe('409 order_not_payable con el detail del estado', () => {
    it.each([
      ['preference', 'expired', 'El pedido venció.'],
      ['card', 'paid', 'El pedido ya está pagado.'],
      ['installments', 'delivered', 'El pedido ya está pagado.'],
      ['cancel', 'cancelled', 'El pedido ya no admite pagos.'],
    ] as const)('%s con el pedido %s → "%s"', async (route, status, detail) => {
      const { number } = order(status)

      const response = await post(route, number, { 'X-Order-Token': ORDER_TOKEN })

      expect(response.status).toBe(409)
      expect(response.body).toEqual({
        type: 'order_not_payable',
        title: 'El pedido no admite un pago nuevo',
        status: 409,
        detail,
        instance: expect.stringContaining(number) as string,
      })
    })
  })

  describe('POST …/preference', () => {
    it('200 con initPoint; ignora un X-CSRF-Token viejo y guarda la clave en minúsculas', async () => {
      const seeded = order()

      const response = await post('preference', seeded.number, {
        'X-Order-Token': ORDER_TOKEN,
        'X-CSRF-Token': 'token-viejo',
        'Idempotency-Key': KEY,
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        initPoint: expect.stringContaining(
          '/__simulated/mercadopago/checkout?preference=',
        ) as string,
      })
      expect(harness.payments.of(seeded.id)).toEqual([
        expect.objectContaining({ method: 'mp_redirect', idempotencyKey: KEY.toLowerCase() }),
      ])
    })

    it('sin Idempotency-Key → 422 antes de leer el pedido', async () => {
      const response = await request(server())
        .post(`/orders/${order().number}/payments/mercadopago/preference`)
        .set('X-Order-Token', ORDER_TOKEN)

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        errors: [{ field: 'Idempotency-Key', code: 'required' }],
      })
      expect(harness.gateway.callsTo('createPreference')).toEqual([])
    })
  })

  describe('POST …/card', () => {
    it('APRO → 200 approved; email y DNI normalizados antes del caso de uso', async () => {
      const seeded = order()

      const response = await post(
        'card',
        seeded.number,
        { 'X-Order-Token': ORDER_TOKEN },
        {
          ...cardBody(),
          installments: 3,
          payer: {
            email: '  Ana@Example.COM ',
            identification: { type: 'DNI', number: '12.345 678' },
          },
        },
      )

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        paymentStatus: 'approved',
        statusDetail: 'accredited',
        challenge: null,
      })
      const [[charge]] = harness.gateway.callsTo('createCardPayment') as [[{ payer: unknown }]]
      expect(charge.payer).toEqual({
        email: 'ana@example.com',
        identification: { type: 'DNI', number: '12345678' },
      })
      expect(harness.orders.get(seeded.id).status).toBe('paid')
    })

    it('3DS → 200 action_required con el desafío', async () => {
      const response = await post(
        'card',
        order().number,
        { 'X-Order-Token': ORDER_TOKEN },
        {
          ...cardBody(),
          token: simToken('3DS'),
        },
      )

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        paymentStatus: 'action_required',
        statusDetail: 'pending_challenge',
        challenge: {
          url: expect.stringContaining('/__simulated/mercadopago/challenge?payment=') as string,
        },
      })
    })

    it('otro tipo de documento: se recorta y se acepta con letras y números', async () => {
      const response = await post(
        'card',
        order().number,
        { 'X-Order-Token': ORDER_TOKEN },
        withDocument('CUIT', ' 20123456786 '),
      )

      expect(response.status).toBe(200)
      const [[charge]] = harness.gateway.callsTo('createCardPayment') as [[{ payer: unknown }]]
      expect(charge.payer).toEqual({
        email: 'ana@example.com',
        identification: { type: 'CUIT', number: '20123456786' },
      })
    })

    it.each([
      [
        'cuotas fuera de 1 a 24',
        cardBody({ installments: 25 }),
        {
          field: 'installments',
          code: 'too_big',
          message: 'Esa cantidad de cuotas no está disponible para esta tarjeta.',
        },
      ],
      [
        'cuotas que no son un entero',
        cardBody({ installments: '3' }),
        {
          field: 'installments',
          code: 'invalid_type',
          message: 'Esa cantidad de cuotas no está disponible para esta tarjeta.',
        },
      ],
      [
        'DNI de 6 dígitos',
        withDocument('DNI', '123456'),
        { field: 'payer.identification.number', code: 'invalid_format', message: 'DNI inválido' },
      ],
      [
        'DNI con letras',
        withDocument('DNI', '1234567A'),
        { field: 'payer.identification.number', code: 'invalid_format', message: 'DNI inválido' },
      ],
      [
        'otro documento con símbolos',
        withDocument('CUIT', '20-1234567-8'),
        {
          field: 'payer.identification.number',
          code: 'invalid_format',
          message: 'Documento inválido',
        },
      ],
      [
        'sin tipo de documento',
        withDocument('', '12345678'),
        { field: 'payer.identification.type', code: 'too_small', message: 'Requerido' },
      ],
      [
        'email inválido',
        cardBody({
          payer: { email: 'no-es-email', identification: { type: 'DNI', number: '12345678' } },
        }),
        { field: 'payer.email', code: 'invalid_email', message: 'Ingresá un email válido' },
      ],
      [
        'sin issuerId (es obligatorio aunque admita null)',
        without(cardBody(), 'issuerId'),
        { field: 'issuerId', code: 'required', message: 'El banco emisor no es válido.' },
      ],
      [
        'token vacío',
        cardBody({ token: '' }),
        {
          field: 'token',
          code: 'too_small',
          message: 'El token de la tarjeta no es válido. Volvé a cargar la tarjeta.',
        },
      ],
      [
        'sin payer',
        without(cardBody(), 'payer'),
        { field: 'payer', code: 'required', message: 'Completá los datos de quien paga.' },
      ],
    ])('%s → 422 con field, code y message exactos', async (_name, body, error) => {
      const response = await post('card', order().number, { 'X-Order-Token': ORDER_TOKEN }, body)

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({ type: 'validation_error', status: 422 })
      expect((response.body as { errors: unknown[] }).errors[0]).toEqual(error)
      expect(harness.gateway.callsTo('createCardPayment')).toEqual([])
    })

    it('token que no es de la pasarela → 422 invalid_token', async () => {
      const response = await post(
        'card',
        order().number,
        { 'X-Order-Token': ORDER_TOKEN },
        {
          ...cardBody(),
          token: 'no-es-un-token',
        },
      )

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        errors: [
          {
            field: 'token',
            code: 'invalid_token',
            message: 'El token de la tarjeta no es válido. Volvé a cargar la tarjeta.',
          },
        ],
      })
    })
  })

  describe('POST …/installments', () => {
    it('crédito → 5 opciones sobre el total; débito → solo 1 pago', async () => {
      const { number } = order()

      const credit = await post('installments', number, { 'X-Order-Token': ORDER_TOKEN })
      const debit = await post(
        'installments',
        number,
        { 'X-Order-Token': ORDER_TOKEN },
        {
          bin: '450312',
          paymentTypeId: 'debit_card',
        },
      )

      expect(credit.status).toBe(200)
      expect((credit.body as { installments: number }[]).map((o) => o.installments)).toEqual([
        1, 2, 3, 6, 12,
      ])
      expect(debit.status).toBe(200)
      expect(debit.body).toEqual([
        {
          installments: 1,
          installmentAmountArs: 68397,
          totalArs: 68397,
          cftPercent: 0,
          teaPercent: 0,
          label: '1 pago de $68.397',
        },
      ])
    })

    it.each([
      [
        { bin: '4503', paymentTypeId: 'credit_card' },
        {
          field: 'bin',
          code: 'invalid_format',
          message: 'Ingresá los primeros 6 a 8 dígitos de la tarjeta.',
        },
      ],
      [
        { bin: '450312345', paymentTypeId: 'credit_card' },
        {
          field: 'bin',
          code: 'invalid_format',
          message: 'Ingresá los primeros 6 a 8 dígitos de la tarjeta.',
        },
      ],
      [
        { bin: '45031234', paymentTypeId: 'prepaid_card' },
        {
          field: 'paymentTypeId',
          code: 'invalid_value',
          message: 'Elegí si la tarjeta es de crédito o de débito.',
        },
      ],
    ])('%o → 422', async (body, error) => {
      const response = await post(
        'installments',
        order().number,
        { 'X-Order-Token': ORDER_TOKEN },
        body,
      )

      expect(response.status).toBe(422)
      expect((response.body as { errors: unknown[] }).errors).toEqual([error])
    })
  })

  describe('POST …/cancel-payment', () => {
    it('204 sin cuerpo, también repetido; el pedido queda cancelled y vencible', async () => {
      const seeded = order()
      await post('preference', seeded.number, { 'X-Order-Token': ORDER_TOKEN })

      const first = await post('cancel', seeded.number, { 'X-Order-Token': ORDER_TOKEN })
      const second = await post('cancel', seeded.number, { 'X-Order-Token': ORDER_TOKEN })

      expect(first.status).toBe(204)
      expect(first.text).toBe('')
      expect(second.status).toBe(204)
      expect(harness.orders.get(seeded.id).paymentStatus).toBe('cancelled')
    })
  })
})
