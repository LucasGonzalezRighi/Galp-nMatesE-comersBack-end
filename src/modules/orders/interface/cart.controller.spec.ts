import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { firstError } from '../../../../test/support/http'
import { QuoteCartQuery } from '../application/queries/quote-cart.query'
import { QuoteShippingQuery } from '../application/queries/quote-shipping.query'
import { CartController } from './cart.controller'

/** Mate con sus opciones, como lo manda la tienda. */
const MATE_LINE = {
  type: 'product',
  productId: 'prd-imperial-premium',
  quantity: 1,
  options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
}

/** Kit con el precio visto, como lo manda la tienda en `POST /orders`. */
const KIT_LINE = {
  type: 'kit',
  mateId: 'prd-imperial-premium',
  bombillaId: 'prd-bombillon-premium-curvo',
  yerbaId: 'prd-yerba-canarias',
  leather: 'Negro',
  quantity: 2,
  expectedUnitPriceArs: 75997,
}

/** Combo con mate y el precio visto, como lo manda la tienda. */
const COMBO_LINE = {
  type: 'combo',
  comboId: 'cmb-duo-imperial',
  quantity: 2,
  options: { leather: 'Marrón', ferrule: 'Acero' },
  expectedUnitPriceArs: 61999,
}

/** Cotización que devuelve el caso de uso simulado (el controlador la pasa tal cual). */
const QUOTE = {
  lines: [],
  itemsGrossArs: 0,
  kitSavingsArs: 0,
  subtotalArs: 0,
  netSubtotalArs: null,
}

describe('CartController (HTTP con casos de uso simulados)', () => {
  const quoteCart = { execute: vi.fn(() => Promise.resolve(QUOTE)) }
  const quoteShipping = {
    execute: vi.fn(() => Promise.resolve({ method: 'home', costArs: 6500, eta: '3 a 6 días' })),
  }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [CartController],
      providers: [
        { provide: QuoteCartQuery, useValue: quoteCart },
        { provide: QuoteShippingQuery, useValue: quoteShipping },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    quoteCart.execute.mockClear()
    quoteShipping.execute.mockClear()
  })

  function post(path: string, body: unknown): request.Test {
    if (app === undefined) throw new Error('La app no arrancó')
    return request(app.getHttpServer())
      .post(path)
      .send(body as object)
  }

  it('POST /cart/quote → 200 con la cotización; ignora un X-CSRF-Token viejo', async () => {
    const response = await post('/cart/quote', {
      items: [MATE_LINE, { ...MATE_LINE, productId: 'prd-bombillon', options: null }, KIT_LINE],
    }).set('X-CSRF-Token', 'token-viejo')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(QUOTE)
    expect(quoteCart.execute).toHaveBeenCalledWith([
      MATE_LINE,
      { ...MATE_LINE, productId: 'prd-bombillon', options: null },
      KIT_LINE,
    ])
  })

  it('POST /cart/quote acepta un combo; sin options ni precio visto llega con options null', async () => {
    const withoutOptions = { type: 'combo', comboId: 'cmb-bombilla-y-yerba', quantity: 1 }

    const response = await post('/cart/quote', { items: [COMBO_LINE, withoutOptions] })

    expect(response.status).toBe(200)
    expect(quoteCart.execute).toHaveBeenCalledWith([
      COMBO_LINE,
      { ...withoutOptions, options: null },
    ])
  })

  it('POST /cart/quote: un producto sin options llega con options null', async () => {
    const withoutOptions = { type: 'product', productId: MATE_LINE.productId, quantity: 1 }

    const response = await post('/cart/quote', { items: [withoutOptions] })

    expect(response.status).toBe(200)
    expect(quoteCart.execute).toHaveBeenCalledWith([{ ...withoutOptions, options: null }])
  })

  it.each([
    [
      'carrito vacío',
      { items: [] },
      { field: 'items', code: 'too_small', message: 'Agregá al menos un producto.' },
    ],
    [
      '51 líneas',
      { items: Array.from({ length: 51 }, () => MATE_LINE) },
      { field: 'items', code: 'too_big', message: 'El carrito puede tener hasta 50 líneas.' },
    ],
    [
      'cantidad 21',
      { items: [{ ...MATE_LINE, quantity: 21 }] },
      { field: 'items.0.quantity', code: 'too_big', message: 'La cantidad no puede pasar de 20.' },
    ],
    [
      'cantidad 0',
      { items: [{ ...KIT_LINE, quantity: 0 }] },
      {
        field: 'items.0.quantity',
        code: 'too_small',
        message: 'La cantidad tiene que ser al menos 1.',
      },
    ],
    [
      'cantidad decimal',
      { items: [{ ...MATE_LINE, quantity: 1.5 }] },
      {
        field: 'items.0.quantity',
        code: 'invalid_type',
        message: 'La cantidad tiene que ser un número entero.',
      },
    ],
    [
      'type desconocido',
      { items: [{ ...MATE_LINE, type: 'regalo' }] },
      {
        field: 'items.0.type',
        code: 'invalid_value',
        message: 'El tipo de la línea tiene que ser product, kit o combo.',
      },
    ],
    [
      'una línea null',
      { items: [MATE_LINE, null] },
      {
        field: 'items.1.type',
        code: 'invalid_value',
        message: 'El tipo de la línea tiene que ser product, kit o combo.',
      },
    ],
    [
      'comboId vacío',
      { items: [{ ...COMBO_LINE, comboId: '' }] },
      { field: 'items.0.comboId', code: 'too_small', message: 'Elegí un combo válido.' },
    ],
    [
      'precio visto de un combo de más de 99.999.999',
      { items: [{ ...COMBO_LINE, expectedUnitPriceArs: 100_000_000 }] },
      {
        field: 'items.0.expectedUnitPriceArs',
        code: 'too_big',
        message: 'El precio visto tiene que ser un monto entero en pesos.',
      },
    ],
    [
      'campo de más en un combo',
      { items: [{ ...COMBO_LINE, productId: 'prd-x' }] },
      {
        field: 'items.0.productId',
        code: 'unrecognized_key',
        message: 'Este campo no está permitido.',
      },
    ],
    [
      'cuero que no existe en un kit',
      { items: [{ ...KIT_LINE, leather: 'Verde' }] },
      { field: 'items.0.leather', code: 'invalid_value', message: 'Elegí el cuero del mate.' },
    ],
    [
      'campo de más en un producto',
      { items: [{ ...MATE_LINE, mateId: 'prd-x' }] },
      {
        field: 'items.0.mateId',
        code: 'unrecognized_key',
        message: 'Este campo no está permitido.',
      },
    ],
  ])('POST /cart/quote con %s → 422 con el campo exacto', async (_name, body, expected) => {
    const response = await post('/cart/quote', body)

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ type: 'validation_error' })
    expect(firstError(response)).toEqual(expected)
    expect(quoteCart.execute).not.toHaveBeenCalled()
  })

  it('POST /shipping/quote → 200; el código postal va en mayúsculas y admite null', async () => {
    const home = await post('/shipping/quote', {
      method: 'home',
      postalCode: ' c1043 ',
      items: [MATE_LINE],
    })
    const pickup = await post('/shipping/quote', {
      method: 'pickup',
      postalCode: null,
      items: [MATE_LINE],
    })

    expect(home.status).toBe(200)
    expect(home.body).toEqual({ method: 'home', costArs: 6500, eta: '3 a 6 días' })
    expect(pickup.status).toBe(200)
    expect(quoteShipping.execute).toHaveBeenNthCalledWith(1, {
      method: 'home',
      postalCode: 'C1043',
      items: [MATE_LINE],
    })
    expect(quoteShipping.execute).toHaveBeenNthCalledWith(2, {
      method: 'pickup',
      postalCode: null,
      items: [MATE_LINE],
    })
  })

  it('POST /shipping/quote con un método o un código postal inválidos → 422', async () => {
    const method = await post('/shipping/quote', {
      method: 'drone',
      postalCode: '1414',
      items: [MATE_LINE],
    })
    const postalCode = await post('/shipping/quote', {
      method: 'home',
      postalCode: '14',
      items: [MATE_LINE],
    })

    expect(firstError(method)).toEqual({
      field: 'method',
      code: 'invalid_value',
      message: 'Elegí un método de envío.',
    })
    expect(firstError(postalCode)).toEqual({
      field: 'postalCode',
      code: 'invalid_format',
      message: 'Código postal inválido',
    })
    expect(quoteShipping.execute).not.toHaveBeenCalled()
  })
})
