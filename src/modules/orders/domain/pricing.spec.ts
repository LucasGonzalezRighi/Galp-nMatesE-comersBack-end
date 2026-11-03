import { describe, expect, it } from 'vitest'

import { PRICING_SETTINGS, PRODUCTS, productMap } from '../../../../test/support/orders'
import type { CartItem, KitCartItem, ProductCartItem } from './cart-line'
import { CartValidationError } from './orders-errors'
import {
  MAX_TOTAL_ARS,
  netPrice,
  priceCart,
  type PricedProduct,
  stockChangeNotice,
} from './pricing'

const { imperialPremium, coquito, galleta, torpedoAcero, bombillon100, yerbaCanarias } = PRODUCTS

function mate(quantity: number, extra: Partial<ProductCartItem> = {}): ProductCartItem {
  return {
    type: 'product',
    productId: imperialPremium.id,
    quantity,
    options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
    ...extra,
  }
}

function product(productId: string, quantity: number): ProductCartItem {
  return { type: 'product', productId, quantity, options: null }
}

function kit(quantity: number, extra: Partial<KitCartItem> = {}): KitCartItem {
  return {
    type: 'kit',
    mateId: imperialPremium.id,
    bombillaId: bombillon100.id,
    yerbaId: yerbaCanarias.id,
    leather: 'Negro',
    quantity,
    ...extra,
  }
}

function price(items: CartItem[], products = productMap(), settings = PRICING_SETTINGS) {
  return priceCart(items, products, settings)
}

describe('priceCart: Review Focus 5', () => {
  it('cotiza un kit [39999, 25999, 9999] × 2 con 10 % con las cuentas exactas', () => {
    const priced = price([kit(2)])
    const [line] = priced.quote.lines

    expect(line).toEqual({
      key: `kit:${imperialPremium.id}:${bombillon100.id}:${yerbaCanarias.id}:Negro`,
      type: 'kit',
      name: 'Kit',
      detail: 'Mate Imperial Premium + Bombillón 100% Alpaca + Yerba Canarias 1 kg · Cuero negro',
      unitPriceArs: 75997,
      netUnitPriceArs: 56526,
      kitSavingsArs: 15200,
      totalArs: 136794,
      maxQuantity: 12,
      issue: null,
    })
    expect(netPrice(68397, 21)).toBe(56526)
    expect(priced.quote).toMatchObject({
      itemsGrossArs: 151994,
      kitSavingsArs: 15200,
      subtotalArs: 136794,
      netSubtotalArs: 113053,
    })
    expect(priced.lines).toEqual([
      {
        type: 'kit',
        name: 'Kit',
        detail: line?.detail,
        quantity: 2,
        unitPriceArs: 75997,
        kitSavingsArs: 15200,
        totalArs: 136794,
        productId: null,
        productSlug: null,
        options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
        kitItems: [
          {
            role: 'mate',
            productId: imperialPremium.id,
            slug: imperialPremium.slug,
            name: imperialPremium.name,
            unitPriceArs: 39999,
          },
          {
            role: 'bombilla',
            productId: bombillon100.id,
            slug: bombillon100.slug,
            name: bombillon100.name,
            unitPriceArs: 25999,
          },
          {
            role: 'yerba',
            productId: yerbaCanarias.id,
            slug: yerbaCanarias.slug,
            name: yerbaCanarias.name,
            unitPriceArs: 9999,
          },
        ],
      },
    ])
    expect(priced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 2 },
      { productId: bombillon100.id, quantity: 2 },
      { productId: yerbaCanarias.id, quantity: 2 },
    ])
  })

  it('la clave de un mate con Alpaca cincelada conserva el espacio y el detail sigue al mock', () => {
    const priced = price([mate(1)])

    expect(priced.quote.lines[0]).toMatchObject({
      key: `product:${imperialPremium.id}:Negro:Alpaca cincelada`,
      name: 'Mate Imperial Premium',
      detail: 'Cuero negro · Alpaca cincelada',
    })
    expect(priced.lines[0]).toMatchObject({
      productId: imperialPremium.id,
      productSlug: 'mate-imperial-premium',
      options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
      kitItems: null,
    })
  })

  it('un mate suelto ×3 y en un kit ×1 con 3 disponibles deja la segunda línea sold_out', () => {
    const products = productMap([{ ...imperialPremium, available: 3 }, bombillon100, yerbaCanarias])
    const priced = price([mate(3), kit(1)], products)

    expect(priced.quote.lines.map((line) => line.issue)).toEqual([null, 'sold_out'])
    expect(priced.quote.lines[1]).toMatchObject({
      unitPriceArs: 0,
      netUnitPriceArs: 0,
      kitSavingsArs: 0,
      totalArs: 0,
      maxQuantity: 0,
    })
    expect(priced.stockChanges).toEqual([
      { kind: 'stock', productId: imperialPremium.id, message: 'Mate Imperial Premium se agotó.' },
    ])
    expect(priced.lines).toHaveLength(1)
    expect(priced.reservation).toEqual([{ productId: imperialPremium.id, quantity: 3 }])
  })

  it('el tope de 20 por producto se comparte entre líneas: mate ×15 y un kit ×10 deja el kit en 5', () => {
    const products = productMap([
      { ...imperialPremium, available: 50 },
      bombillon100,
      yerbaCanarias,
    ])
    const priced = price([mate(15), kit(10)], products)

    expect(priced.quote.lines[0]).toMatchObject({
      issue: null,
      maxQuantity: 20,
      totalArs: 599985,
    })
    expect(priced.quote.lines[1]).toMatchObject({
      issue: 'quantity_reduced',
      maxQuantity: 5,
      unitPriceArs: 75997,
      kitSavingsArs: 38000,
      totalArs: 341985,
    })
    expect(priced.stockChanges).toEqual([
      {
        kind: 'stock',
        productId: imperialPremium.id,
        message: 'Quedan 5 unidades de Mate Imperial Premium.',
      },
    ])
    expect(priced.lines.map((line) => line.quantity)).toEqual([15, 5])
    expect(priced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 20 },
      { productId: bombillon100.id, quantity: 5 },
      { productId: yerbaCanarias.id, quantity: 5 },
    ])
  })
})

describe('priceCart: líneas', () => {
  it('cotiza un mate suelto con maxQuantity 12 y el neto 33057', () => {
    const priced = price([mate(1)])

    expect(priced.quote.lines[0]).toMatchObject({
      unitPriceArs: 39999,
      netUnitPriceArs: 33057,
      kitSavingsArs: 0,
      totalArs: 39999,
      maxQuantity: 12,
      issue: null,
    })
    expect(priced.quote.netSubtotalArs).toBe(33057)
    expect(priced.stockChanges).toEqual([])
    expect(priced.priceChanges).toEqual([])
    expect(priced.optionErrors).toEqual([])
  })

  it('un producto sin stock sale sold_out con los importes en 0 y no suma', () => {
    const priced = price([mate(1, { productId: galleta.id }), mate(1)])

    expect(priced.quote.lines[0]).toMatchObject({
      issue: 'sold_out',
      unitPriceArs: 0,
      totalArs: 0,
      maxQuantity: 0,
    })
    expect(priced.quote.subtotalArs).toBe(39999)
    expect(priced.stockChanges).toEqual([
      { kind: 'stock', productId: galleta.id, message: 'Mate Galleta se agotó.' },
    ])
  })

  it('con menos stock que lo pedido cotiza quantity_reduced con el máximo', () => {
    const priced = price([mate(5, { productId: coquito.id })])

    expect(priced.quote.lines[0]).toMatchObject({
      issue: 'quantity_reduced',
      maxQuantity: 2,
      totalArs: 57998,
    })
    expect(priced.lines[0]?.quantity).toBe(2)
    expect(priced.reservation).toEqual([{ productId: coquito.id, quantity: 2 }])
    expect(priced.stockChanges).toEqual([
      {
        kind: 'stock',
        productId: coquito.id,
        message: 'Quedan 2 unidades de Mate Coquito Criollo.',
      },
    ])
  })

  it('un id inexistente o un producto sin precio salen unavailable', () => {
    const priced = price([product('prd-no-existe', 1), mate(1, { productId: torpedoAcero.id })])

    expect(priced.quote.lines.map((line) => [line.issue, line.totalArs, line.name])).toEqual([
      ['unavailable', 0, 'Producto no disponible'],
      ['unavailable', 0, 'Mate Torpedo Línea Acero'],
    ])
    expect(priced.quote.lines[0]?.key).toBe('product:prd-no-existe:-:-')
    expect(priced.stockChanges).toEqual([
      {
        kind: 'unavailable',
        productId: 'prd-no-existe',
        message: 'Producto no disponible ya no está disponible.',
      },
      {
        kind: 'unavailable',
        productId: torpedoAcero.id,
        message: 'Mate Torpedo Línea Acero ya no está disponible.',
      },
    ])
    expect(priced.optionErrors).toEqual([])
    expect(priced.lines).toEqual([])
  })

  it('un producto no publicado sale unavailable', () => {
    const products = productMap([{ ...imperialPremium, published: false }])

    expect(price([mate(1)], products).quote.lines[0]?.issue).toBe('unavailable')
  })

  it('un kit con una pieza de otro grupo sale unavailable con el id de esa pieza', () => {
    const priced = price([kit(1, { bombillaId: yerbaCanarias.id })])

    expect(priced.quote.lines[0]).toMatchObject({ issue: 'unavailable', name: 'Kit', totalArs: 0 })
    expect(priced.stockChanges).toEqual([
      {
        kind: 'unavailable',
        productId: yerbaCanarias.id,
        message: 'Yerba Canarias 1 kg ya no está disponible.',
      },
    ])
  })

  it('ignora las opciones en un producto que no es mate', () => {
    const item: ProductCartItem = {
      type: 'product',
      productId: bombillon100.id,
      quantity: 1,
      options: { leather: 'Crudo', ferrule: 'Acero' },
    }
    const priced = price([item])

    expect(priced.quote.lines[0]).toMatchObject({
      key: `product:${bombillon100.id}:-:-`,
      detail: '',
      issue: null,
    })
    expect(priced.lines[0]?.options).toBeNull()
  })

  it('un mate sin opciones deja un error de campo', () => {
    const priced = price([product(yerbaCanarias.id, 1), product(imperialPremium.id, 1)])

    expect(priced.optionErrors).toEqual([
      {
        field: 'items.1.options',
        code: 'required',
        message: 'Elegí el cuero y la virola del mate.',
      },
    ])
  })

  it('un precio esperado distinto sale price_changed con el aviso', () => {
    const priced = price([mate(1, { expectedUnitPriceArs: 35999 })])

    expect(priced.quote.lines[0]).toMatchObject({ issue: 'price_changed', unitPriceArs: 39999 })
    expect(priced.priceChanges).toEqual([
      {
        kind: 'price',
        productId: imperialPremium.id,
        message: 'Mate Imperial Premium cambió de precio: ahora cuesta $39.999.',
      },
    ])
    expect(priced.stockChanges).toEqual([])
    expect(price([mate(1, { expectedUnitPriceArs: 39999 })]).priceChanges).toEqual([])
  })

  it('quantity_reduced le gana a price_changed', () => {
    const priced = price([mate(5, { productId: coquito.id, expectedUnitPriceArs: 1 })])

    expect(priced.quote.lines[0]?.issue).toBe('quantity_reduced')
    expect(priced.priceChanges).toEqual([])
    expect(priced.stockChanges).toHaveLength(1)
  })

  it('con showNetPrice apagado los netos son null, también en las bloqueadas', () => {
    const settings = { ...PRICING_SETTINGS, showNetPrice: false }
    const priced = price([mate(1), mate(1, { productId: galleta.id })], productMap(), settings)

    expect(priced.quote.lines.map((line) => line.netUnitPriceArs)).toEqual([null, null])
    expect(priced.quote.netSubtotalArs).toBeNull()
  })

  it('la reserva suma el mismo producto de varias líneas', () => {
    const priced = price([mate(1), kit(2), product(yerbaCanarias.id, 3)])

    expect(priced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 3 },
      { productId: bombillon100.id, quantity: 2 },
      { productId: yerbaCanarias.id, quantity: 5 },
    ])
  })

  it('un total de más de 2.147.483.647 es un error de validación de items', () => {
    const huge: PricedProduct[] = ['prd-a', 'prd-b'].map((id) => ({
      id,
      slug: id,
      name: id,
      group: 'yerba',
      priceArs: 99_999_999,
      published: true,
      available: 20,
    }))
    const run = () => price([product('prd-a', 20), product('prd-b', 20)], productMap(huge))

    expect(run).toThrow(CartValidationError)
    expect(run).toThrow(
      expect.objectContaining({
        status: 422,
        code: 'validation_error',
        errors: [
          { field: 'items', code: 'too_big', message: 'El total del carrito es demasiado grande.' },
        ],
      }),
    )
    expect(MAX_TOTAL_ARS).toBe(2_147_483_647)
  })

  it('rechaza un carrito vacío o una cantidad fuera de rango', () => {
    expect(() => price([])).toThrow(RangeError)
    expect(() => price([mate(21)])).toThrow(RangeError)
  })
})

describe('stockChangeNotice', () => {
  it('dice cuántas unidades quedan, en singular o plural, o que se agotó', () => {
    expect(stockChangeNotice('p', 'Mate X', 1).message).toBe('Queda 1 unidad de Mate X.')
    expect(stockChangeNotice('p', 'Mate X', 3).message).toBe('Quedan 3 unidades de Mate X.')
    expect(stockChangeNotice('p', 'Mate X', 0)).toEqual({
      kind: 'stock',
      productId: 'p',
      message: 'Mate X se agotó.',
    })
  })
})
