import { MPBadRequestError, MPNotFoundError, MPServerError } from 'mercadopago'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FixedClock } from '../../../../test/support/clock'
import { RecordingPaymentsLogger } from '../../../../test/support/payments'
import type { OrderForPayment } from '../../orders/application/ports/order-payments.port'
import { InvalidCardTokenError, PaymentGatewayError } from '../domain/payments-errors'
import { createMercadoPagoClients, MercadoPagoGateway } from './mercadopago.gateway'

const ACCESS_TOKEN = 'TEST-0000000000000000-000000-00000000000000000000000000000000-000000000'

const ORDER: OrderForPayment = {
  id: '019a0000-0000-7000-8000-000000000001',
  number: 'GLP-10001',
  status: 'pending_payment',
  paymentStatus: 'none',
  paymentMethod: 'card',
  totalArs: 79998,
  shippingCostArs: 0,
  accessTokenHash: 'hash',
  reservedUntil: new Date('2026-11-02T12:30:00.000Z'),
  createdAt: new Date('2026-11-02T12:00:00.000Z'),
  customerId: null,
  contact: { email: 'ana@example.com', firstName: 'Ana', lastName: 'Gómez', phone: null },
  lines: [{ id: 'line-1', name: 'Mate Imperial Premium', quantity: 2, totalArs: 79998 }],
}

const APPROVED = {
  id: 1234567890,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 79998,
  transaction_amount_refunded: 0,
  installments: 1,
  payment_type_id: 'credit_card',
  payment_method_id: 'visa',
  external_reference: 'GLP-10001',
  date_approved: '2026-11-02T09:01:00.000-03:00',
  card: { last_four_digits: '3704' },
}

/** Pasarela con el SDK reemplazado por dobles y un `fetch` falso. */
function gatewayWith(fetchImpl?: typeof fetch) {
  const clients = {
    preference: { create: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn(), get: vi.fn(), cancel: vi.fn() },
    refund: { create: vi.fn() },
  }
  const logger = new RecordingPaymentsLogger()
  const fetchMock = vi.fn(fetchImpl ?? (() => Promise.resolve(Response.json([]))))
  const gateway = new MercadoPagoGateway(
    { accessToken: ACCESS_TOKEN, clock: new FixedClock(), logger, fetch: fetchMock },
    clients,
  )
  return { clients, fetchMock, gateway, logger }
}

describe('MercadoPagoGateway', () => {
  it('crea la preferencia con la clave idempotente del intento', async () => {
    const { clients, gateway } = gatewayWith()
    clients.preference.create.mockResolvedValue({
      id: '787997534-6dad21a1-6145-4f0d-ac21-66bf7a5e7a58',
      init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=787997534-6dad21a1',
    })

    const result = await gateway.createPreference({
      order: ORDER,
      idempotencyKey: 'key-1',
      notificationUrl: null,
      backUrl: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
      expiresAt: ORDER.reservedUntil,
      statementDescriptor: 'GALPON MATES',
    })

    expect(result).toEqual({
      preferenceId: '787997534-6dad21a1-6145-4f0d-ac21-66bf7a5e7a58',
      initPoint: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=787997534-6dad21a1',
    })
    expect(clients.preference.create.mock.calls[0]?.[0]).toMatchObject({
      body: {
        external_reference: 'GLP-10001',
        expiration_date_from: '2026-11-02T09:00:00.000-03:00',
        expiration_date_to: '2026-11-02T09:30:00.000-03:00',
      },
      requestOptions: { idempotencyKey: 'key-1' },
    })
  })

  it('una preferencia sin init_point es un error de la pasarela', async () => {
    const { clients, gateway } = gatewayWith()
    clients.preference.create.mockResolvedValue({ id: 'pref' })

    await expect(
      gateway.createPreference({
        order: ORDER,
        idempotencyKey: 'key-1',
        notificationUrl: null,
        backUrl: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
        expiresAt: ORDER.reservedUntil,
        statementDescriptor: 'GALPON MATES',
      }),
    ).rejects.toThrow(PaymentGatewayError)
  })

  it('vence una preferencia con PUT expires y expiration_date_to en el pasado', async () => {
    const { clients, gateway } = gatewayWith()
    clients.preference.update.mockResolvedValue({ id: 'pref-1' })

    await gateway.expirePreference('pref-1')

    expect(clients.preference.update).toHaveBeenCalledWith({
      id: 'pref-1',
      updatePreferenceRequest: {
        expires: true,
        expiration_date_from: '2026-11-02T08:59:00.000-03:00',
        expiration_date_to: '2026-11-02T08:59:59.000-03:00',
      },
      requestOptions: { idempotencyKey: expect.any(String) as unknown },
    })
  })

  it('cobra con tarjeta con X-Idempotency-Key y mapea la respuesta', async () => {
    const { clients, gateway } = gatewayWith()
    clients.payment.create.mockResolvedValue(APPROVED)

    const payment = await gateway.createCardPayment({
      order: ORDER,
      idempotencyKey: 'key-2',
      token: 'tok',
      paymentMethodId: 'visa',
      issuerId: null,
      installments: 1,
      payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
      notificationUrl: null,
      statementDescriptor: 'GALPON MATES',
    })

    expect(payment).toMatchObject({
      providerPaymentId: '1234567890',
      status: 'approved',
      cardLastFour: '3704',
      approvedAt: new Date('2026-11-02T12:01:00.000Z'),
    })
    expect(clients.payment.create.mock.calls[0]?.[0]).toMatchObject({
      body: { token: 'tok', transaction_amount: 79998, capture: true },
      requestOptions: { idempotencyKey: 'key-2' },
    })
  })

  it('un token inválido da InvalidCardTokenError y el log no lleva el token', async () => {
    const { clients, gateway, logger } = gatewayWith()
    clients.payment.create.mockRejectedValue(
      new MPBadRequestError({
        status: 400,
        error: 'bad_request',
        message: 'Invalid card_token_id tok-secreto',
        cause: [{ code: 3003, description: 'Invalid card_token_id' }],
      }),
    )

    await expect(
      gateway.createCardPayment({
        order: ORDER,
        idempotencyKey: 'key-3',
        token: 'tok-secreto',
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
        notificationUrl: null,
        statementDescriptor: 'GALPON MATES',
      }),
    ).rejects.toThrow(InvalidCardTokenError)
    expect(logger.warnings).toEqual([
      'Mercado Pago rechazó cobrar con tarjeta el pedido GLP-10001: status 400, error bad_request, causas [3003: Invalid card_token_id]',
    ])
    expect(logger.warnings.join(' ')).not.toContain('tok-secreto')
    expect(logger.warnings.join(' ')).not.toContain(ACCESS_TOKEN)
  })

  it('un 5xx de Mercado Pago da PaymentGatewayError (502)', async () => {
    const { clients, gateway } = gatewayWith()
    clients.payment.get.mockRejectedValue(new MPServerError({ status: 500, error: 'internal' }))

    await expect(gateway.getPayment('1')).rejects.toThrow(PaymentGatewayError)
  })

  it('getPayment y cancelPayment dan null si Mercado Pago no tiene el pago', async () => {
    const { clients, gateway } = gatewayWith()
    const notFound = new MPNotFoundError({
      status: 404,
      error: 'not_found',
      message: 'Payment not found',
    })
    clients.payment.get.mockRejectedValue(notFound)
    clients.payment.cancel.mockRejectedValue(notFound)

    await expect(gateway.getPayment('999')).resolves.toBeNull()
    await expect(gateway.cancelPayment('999')).resolves.toBeNull()
    expect(clients.payment.get).toHaveBeenCalledWith({ id: '999' })
    expect(clients.payment.cancel).toHaveBeenCalledWith({
      id: '999',
      requestOptions: { idempotencyKey: expect.any(String) as unknown },
    })
  })

  it('cancela un pago pendiente y devuelve cómo quedó', async () => {
    const { clients, gateway } = gatewayWith()
    clients.payment.cancel.mockResolvedValue({
      ...APPROVED,
      status: 'cancelled',
      status_detail: 'by_collector',
      date_approved: undefined,
    })

    await expect(gateway.cancelPayment('1234567890')).resolves.toMatchObject({
      status: 'cancelled',
      statusDetail: 'by_collector',
    })
  })

  it('devuelve el pago completo con su propia clave idempotente', async () => {
    const { clients, gateway } = gatewayWith()
    clients.refund.create.mockResolvedValueOnce({ id: 555, status: 'approved' })
    clients.refund.create.mockResolvedValueOnce({ id: 556, status: 'in_process' })

    await expect(gateway.refundPayment('1234567890', 'refund-key')).resolves.toEqual({
      providerRefundId: '555',
      status: 'approved',
    })
    await expect(gateway.refundPayment('1234567890', 'refund-key-2')).resolves.toEqual({
      providerRefundId: '556',
      status: 'pending',
    })
    expect(clients.refund.create).toHaveBeenCalledWith({
      payment_id: '1234567890',
      requestOptions: { idempotencyKey: 'refund-key' },
    })
  })

  it('una devolución rechazada por Mercado Pago es un error', async () => {
    const { clients, gateway } = gatewayWith()
    clients.refund.create.mockResolvedValue({ id: 557, status: 'rejected' })

    await expect(gateway.refundPayment('1234567890', 'refund-key')).rejects.toThrow(
      'Mercado Pago rechazó la devolución del pago 1234567890 (rejected)',
    )
  })

  it('consulta las cuotas con fetch, el access token y el total del pedido', async () => {
    const { fetchMock, gateway } = gatewayWith(() =>
      Promise.resolve(
        Response.json([
          {
            payer_costs: [
              {
                installments: 1,
                installment_amount: 79998,
                total_amount: 79998,
                labels: ['CFT_0,00%|TEA_0,00%'],
                recommended_message: '1 cuota de $ 79.998,00',
              },
            ],
          },
        ]),
      ),
    )

    const options = await gateway.getInstallments({
      bin: '45099535',
      paymentTypeId: 'credit_card',
      amountArs: 79998,
      maxWithoutInterest: 3,
    })

    expect(options).toEqual([
      {
        installments: 1,
        installmentAmountArs: 79998,
        totalArs: 79998,
        cftPercent: 0,
        teaPercent: 0,
        label: '1 cuota de $ 79.998,00',
      },
    ])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url instanceof URL ? url.href : url).toBe(
      'https://api.mercadopago.com/v1/payment_methods/installments?bin=45099535&amount=79998&payment_type_id=credit_card',
    )
    expect(init?.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('cuotas: una respuesta no OK o un corte de red dan PaymentGatewayError', async () => {
    const failing = gatewayWith(() =>
      Promise.resolve(Response.json({ message: 'bad' }, { status: 400 })),
    )
    const offline = gatewayWith(() => Promise.reject(new TypeError('fetch failed')))
    const request = {
      bin: '450995',
      paymentTypeId: 'credit_card',
      amountArs: 79998,
      maxWithoutInterest: 3,
    } as const

    await expect(failing.gateway.getInstallments(request)).rejects.toThrow(PaymentGatewayError)
    await expect(offline.gateway.getInstallments(request)).rejects.toThrow(PaymentGatewayError)
    expect(failing.logger.warnings[0]).toContain('status 400')
  })
})

describe('MercadoPagoGateway con los clientes reales del SDK', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Pasarela con los clientes reales del SDK y un `fetch` global falso que anota lo que sale. */
  function realSdkGateway() {
    const sent: { method: string; path: string; idempotencyKey: string | null }[] = []
    const bodies: Record<string, unknown> = {
      'POST /checkout/preferences': { id: 'p1', init_point: 'https://www.mercadopago.com.ar/p1' },
      'PUT /checkout/preferences/p1': { id: 'p1' },
      'POST /v1/payments': APPROVED,
      'PUT /v1/payments/999': { ...APPROVED, id: 999, status: 'cancelled' },
      'POST /v1/payments/1234567890/refunds': { id: 555, status: 'approved' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        // El SDK termina algunos paths en "/" (`/checkout/preferences/`).
        const path = url.pathname.replace(/\/+$/, '')
        const method = init?.method ?? 'GET'
        sent.push({
          method,
          path,
          idempotencyKey: new Headers(init?.headers).get('X-Idempotency-Key'),
        })
        return Promise.resolve(Response.json(bodies[`${method} ${path}`] ?? {}))
      }),
    )
    const gateway = new MercadoPagoGateway(
      { accessToken: ACCESS_TOKEN, clock: new FixedClock() },
      createMercadoPagoClients(ACCESS_TOKEN),
    )
    return { gateway, sent }
  }

  it('vencer la preferencia y cancelar el pago no heredan la clave del último cobro', async () => {
    const { gateway, sent } = realSdkGateway()

    await gateway.createPreference({
      order: ORDER,
      idempotencyKey: 'key-preference',
      notificationUrl: null,
      backUrl: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
      expiresAt: ORDER.reservedUntil,
      statementDescriptor: 'GALPON MATES',
    })
    await gateway.expirePreference('p1')
    await gateway.createCardPayment({
      order: ORDER,
      idempotencyKey: 'key-card',
      token: 'tok_1',
      paymentMethodId: 'visa',
      issuerId: null,
      installments: 1,
      payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
      notificationUrl: null,
      statementDescriptor: 'GALPON MATES',
    })
    await gateway.cancelPayment('999')
    await gateway.refundPayment('1234567890', 'key-refund')
    await gateway.cancelPayment('999')
    await gateway.expirePreference('p1')

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /checkout/preferences',
      'PUT /checkout/preferences/p1',
      'POST /v1/payments',
      'PUT /v1/payments/999',
      'POST /v1/payments/1234567890/refunds',
      'PUT /v1/payments/999',
      'PUT /checkout/preferences/p1',
    ])
    expect(
      sent.filter(({ method }) => method === 'POST').map((call) => call.idempotencyKey),
    ).toEqual(['key-preference', 'key-card', 'key-refund'])
    const own = sent.filter(({ method }) => method === 'PUT').map((call) => call.idempotencyKey)
    expect(own).toHaveLength(4)
    for (const key of own) {
      expect(['key-preference', 'key-card', 'key-refund']).not.toContain(key)
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
    expect(new Set(own).size).toBe(4)
  })
})
