import { describe, expect, it } from 'vitest'

import {
  COMBOS,
  comboMap,
  PRICING_SETTINGS,
  PRODUCTS,
  productMap,
} from '../../../../test/support/orders'
import type { CartItem, ComboCartItem, KitCartItem, ProductCartItem } from './cart-line'
import { CartValidationError } from './orders-errors'
import {
  MAX_TOTAL_ARS,
  MISSING_COMBO_NAME,
  netPrice,
  priceCart,
  type PricedCombo,
  type PricedProduct,
  stockChangeNotice,
} from './pricing'

const {
  imperialPremium,
  coquito,
  galleta,
  torpedoAcero,
  bombillon100,
  bombillonCurvo,
  yerbaCanarias,
} = PRODUCTS
const { duoImperial, bombillaYerba, galletaCanarias } = COMBOS

function mate(quantity: number, extra: Partial<ProductCartItem> = {}): ProductCartItem {
  return {
    type: 'product',
    productId: imperialPremium.id,
    quantity,
    options: { leather: 'Negro' },
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

function combo(quantity: number, extra: Partial<ComboCartItem> = {}): ComboCartItem {
  return {
    type: 'combo',
    comboId: duoImperial.id,
    quantity,
    options: { leather: 'Marrón' },
    ...extra,
  }
}

/** Los productos de prueba con el Mate Imperial Premium ofreciendo solo esos cueros. */
function imperialWith(leathers: PricedProduct['leathers']): Map<string, PricedProduct> {
  return productMap(
    Object.values(PRODUCTS).map((item) =>
      item.id === imperialPremium.id ? { ...item, leathers } : item,
    ),
  )
}

function price(
  items: CartItem[],
  products = productMap(),
  settings = PRICING_SETTINGS,
  combos = comboMap(),
) {
  return priceCart(items, products, combos, settings)
}

describe('priceCart: Review Focus 5', () => {
  it('cotiza un kit [39999, 25999, 9999] × 2 con 10 % con las cuentas exactas', () => {
    const priced = price([kit(2)])
    const [line] = priced.quote.lines

    expect(line).toEqual({
      key: `kit:${imperialPremium.id}:${bombillon100.id}:${yerbaCanarias.id}:Negro`,
      type: 'kit',
      name: 'Kit',
      detail: 'Mate Imperial Premium + Bombillón 100% Alpaca + Yerba Canarias 1 kg · Color negro',
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
        options: { leather: 'Negro' },
        kitItems: [
          {
            role: 'mate',
            position: 1,
            productId: imperialPremium.id,
            slug: imperialPremium.slug,
            name: imperialPremium.name,
            unitPriceArs: 39999,
          },
          {
            role: 'bombilla',
            position: 2,
            productId: bombillon100.id,
            slug: bombillon100.slug,
            name: bombillon100.name,
            unitPriceArs: 25999,
          },
          {
            role: 'yerba',
            position: 3,
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

  it('la clave de un mate es product:{id}:{cuero} y el detail "Color negro", como el mock', () => {
    const priced = price([mate(1)])

    expect(priced.quote.lines[0]).toMatchObject({
      key: `product:${imperialPremium.id}:Negro`,
      name: 'Mate Imperial Premium',
      detail: 'Color negro',
    })
    expect(priced.lines[0]).toMatchObject({
      productId: imperialPremium.id,
      productSlug: 'mate-imperial-premium',
      options: { leather: 'Negro' },
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
    expect(priced.quote.lines[0]?.key).toBe('product:prd-no-existe:-')
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

  it('ignora el cuero en un producto sin cueros, pero la clave repite lo que mandó la tienda', () => {
    const item: ProductCartItem = {
      type: 'product',
      productId: bombillon100.id,
      quantity: 1,
      options: { leather: 'Crudo' },
    }
    const priced = price([item, product(yerbaCanarias.id, 1)])

    expect(priced.quote.lines[0]).toMatchObject({
      key: `product:${bombillon100.id}:Crudo`,
      detail: '',
      issue: null,
    })
    expect(priced.quote.lines[1]?.key).toBe(`product:${yerbaCanarias.id}:-`)
    expect(priced.lines[0]?.options).toBeNull()
    expect(priced.optionErrors).toEqual([])
  })

  it('un mate sin cueros ofrecidos ignora el cuero: detail vacío y options null', () => {
    const products = imperialWith([])
    const priced = price([mate(1), product(imperialPremium.id, 1)], products)

    expect(priced.quote.lines.map(({ key, detail }) => [key, detail])).toEqual([
      [`product:${imperialPremium.id}:Negro`, ''],
      [`product:${imperialPremium.id}:-`, ''],
    ])
    expect(priced.lines.map(({ options }) => options)).toEqual([null, null])
    expect(priced.optionErrors).toEqual([])
  })

  it('un mate con cueros sin options o con uno que no ofrece deja errores de campo', () => {
    const products = imperialWith(['Negro', 'Crudo'])
    const priced = price(
      [
        product(yerbaCanarias.id, 1),
        product(imperialPremium.id, 1),
        mate(1, { options: { leather: 'Marrón' } }),
        mate(1, { options: { leather: 'Crudo' } }),
      ],
      products,
    )

    expect(priced.optionErrors).toEqual([
      { field: 'items.1.options', code: 'required', message: 'Elegí el color del mate.' },
      {
        field: 'items.2.options.leather',
        code: 'leather_not_offered',
        message: 'Ese color no está disponible para este mate.',
      },
    ])
    expect(priced.quote.lines[3]).toMatchObject({
      key: `product:${imperialPremium.id}:Crudo`,
      detail: 'Color crudo',
    })
  })

  it('un mate que no se vende sale unavailable sin error de cuero', () => {
    const products = productMap([{ ...imperialPremium, published: false }])
    const priced = price([product(imperialPremium.id, 1)], products)

    expect(priced.quote.lines[0]).toMatchObject({ issue: 'unavailable', detail: '' })
    expect(priced.optionErrors).toEqual([])
  })

  it('un kit sigue los cueros del mate: null pide cuero, uno que no ofrece da error en leather', () => {
    const priced = price([kit(1, { leather: null }), kit(1, { leather: 'Borravino' })])
    expect(priced.optionErrors).toEqual([
      { field: 'items.0.leather', code: 'required', message: 'Elegí el color del mate.' },
    ])

    const twoLeathers = imperialWith(['Negro', 'Crudo'])
    const notOffered = price([kit(1, { leather: 'Borravino' })], twoLeathers)
    expect(notOffered.optionErrors).toEqual([
      {
        field: 'items.0.leather',
        code: 'leather_not_offered',
        message: 'Ese color no está disponible para este mate.',
      },
    ])
  })

  it('un kit con un mate sin cueros ignora el cuero: clave con lo que mandó y sin el cuero', () => {
    const products = imperialWith([])
    const priced = price([kit(1, { leather: null }), kit(1)], products)

    expect(priced.quote.lines.map(({ key, detail }) => [key, detail])).toEqual([
      [
        `kit:${imperialPremium.id}:${bombillon100.id}:${yerbaCanarias.id}:-`,
        'Mate Imperial Premium + Bombillón 100% Alpaca + Yerba Canarias 1 kg',
      ],
      [
        `kit:${imperialPremium.id}:${bombillon100.id}:${yerbaCanarias.id}:Negro`,
        'Mate Imperial Premium + Bombillón 100% Alpaca + Yerba Canarias 1 kg',
      ],
    ])
    expect(priced.lines.map(({ options }) => options)).toEqual([null, null])
    expect(priced.optionErrors).toEqual([])
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
      leathers: [],
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

describe('priceCart: combos', () => {
  it('cotiza "Dúo Imperial" × 2 como el mock: 68998, 13998 y 123998', () => {
    const priced = price([combo(2)])
    const [line] = priced.quote.lines

    expect(line).toEqual({
      key: 'combo:cmb-duo-imperial:Marrón',
      type: 'combo',
      name: 'Dúo Imperial',
      detail: 'Mate Imperial Premium + Bombillón Premium Curvo · Color marrón',
      unitPriceArs: 68998,
      netUnitPriceArs: 51239,
      kitSavingsArs: 13998,
      totalArs: 123998,
      maxQuantity: 12,
      issue: null,
    })
    expect(netPrice(61999, 21)).toBe(51239)
    expect(priced.quote).toMatchObject({
      itemsGrossArs: 137996,
      kitSavingsArs: 13998,
      subtotalArs: 123998,
      netSubtotalArs: netPrice(123998, 21),
    })
    expect(priced.lines).toEqual([
      {
        type: 'combo',
        name: 'Dúo Imperial',
        detail: line?.detail,
        quantity: 2,
        unitPriceArs: 68998,
        kitSavingsArs: 13998,
        totalArs: 123998,
        productId: null,
        productSlug: null,
        options: { leather: 'Marrón' },
        kitItems: [
          {
            role: 'mate',
            position: 1,
            productId: imperialPremium.id,
            slug: 'mate-imperial-premium',
            name: 'Mate Imperial Premium',
            unitPriceArs: 39999,
          },
          {
            role: 'bombilla',
            position: 2,
            productId: bombillonCurvo.id,
            slug: 'bombillon-premium-curvo',
            name: 'Bombillón Premium Curvo',
            unitPriceArs: 28999,
          },
        ],
      },
    ])
    expect(priced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 2 },
      { productId: bombillonCurvo.id, quantity: 2 },
    ])
    expect(priced.stockChanges).toEqual([])
    expect(priced.priceChanges).toEqual([])
  })

  it('price_changed compara con el precio del combo y avisa con productId null', () => {
    const changed = price([combo(1, { expectedUnitPriceArs: 59999 })])
    const raised = productMap([
      { ...imperialPremium, priceArs: 41999 },
      bombillonCurvo,
      bombillon100,
      yerbaCanarias,
    ])
    const sameCombo = price([combo(2, { expectedUnitPriceArs: 61999 })], raised)

    expect(changed.quote.lines[0]).toMatchObject({ issue: 'price_changed', totalArs: 61999 })
    expect(changed.priceChanges).toEqual([
      {
        kind: 'price',
        productId: null,
        message: 'Dúo Imperial cambió de precio: ahora cuesta $61.999.',
      },
    ])
    expect(sameCombo.quote.lines[0]).toMatchObject({
      issue: null,
      unitPriceArs: 70998,
      kitSavingsArs: 17998,
      totalArs: 123998,
    })
    expect(sameCombo.priceChanges).toEqual([])
  })

  it('un combo en borrador o inexistente sale unavailable con avisos sin producto', () => {
    const priced = price([
      combo(1, { comboId: galletaCanarias.id }),
      combo(1, { comboId: 'cmb-no-existe', options: { leather: 'Negro' } }),
    ])
    const blocked = {
      type: 'combo',
      unitPriceArs: 0,
      netUnitPriceArs: 0,
      kitSavingsArs: 0,
      totalArs: 0,
      maxQuantity: 0,
      issue: 'unavailable',
    }

    expect(priced.quote.lines).toEqual([
      {
        ...blocked,
        key: 'combo:cmb-galleta-y-canarias:Marrón',
        name: 'Galleta y Canarias',
        detail: 'Mate Galleta + Yerba Canarias 1 kg · Color marrón',
      },
      {
        ...blocked,
        key: 'combo:cmb-no-existe:Negro',
        name: MISSING_COMBO_NAME,
        detail: '',
      },
    ])
    expect(MISSING_COMBO_NAME).toBe('Combo no disponible')
    expect(priced.stockChanges).toEqual([
      {
        kind: 'unavailable',
        productId: null,
        message: 'Galleta y Canarias ya no está disponible.',
      },
      {
        kind: 'unavailable',
        productId: null,
        message: 'Combo no disponible ya no está disponible.',
      },
    ])
    expect(priced.lines).toEqual([])
    expect(priced.reservation).toEqual([])
    expect(priced.optionErrors).toEqual([])
  })

  it('una pieza archivada, sin precio o inexistente deja el combo unavailable con su id', () => {
    const archived = price(
      [combo(1)],
      productMap([{ ...imperialPremium, published: false }, bombillonCurvo]),
    )
    const unpriced = price(
      [combo(1)],
      productMap(),
      PRICING_SETTINGS,
      comboMap([{ ...duoImperial, productIds: [torpedoAcero.id, bombillonCurvo.id] }]),
    )
    const missing = price([combo(1)], productMap([bombillonCurvo]))

    expect(archived.quote.lines[0]).toMatchObject({
      name: 'Dúo Imperial',
      issue: 'unavailable',
      totalArs: 0,
    })
    expect(archived.stockChanges).toEqual([
      {
        kind: 'unavailable',
        productId: imperialPremium.id,
        message: 'Dúo Imperial ya no está disponible.',
      },
    ])
    expect(unpriced.stockChanges[0]?.productId).toBe(torpedoAcero.id)
    expect(missing.quote.lines[0]).toMatchObject({
      detail: 'Producto no disponible + Bombillón Premium Curvo',
      issue: 'unavailable',
    })
    expect(missing.stockChanges[0]?.productId).toBe(imperialPremium.id)
  })

  it('piezas que ya no son de grupos distintos dejan el combo unavailable, sin error', () => {
    const sameGroup: PricedCombo = { ...duoImperial, productIds: [imperialPremium.id, coquito.id] }
    const priced = price([combo(1)], productMap(), PRICING_SETTINGS, comboMap([sameGroup]))

    expect(priced.quote.lines[0]).toMatchObject({ issue: 'unavailable', totalArs: 0 })
    expect(priced.stockChanges).toEqual([
      { kind: 'unavailable', productId: null, message: 'Dúo Imperial ya no está disponible.' },
    ])
    expect(priced.lines).toEqual([])
  })

  it('un combo con un mate con cueros: sin options o con uno que no ofrece, error de campo', () => {
    const products = imperialWith(['Negro', 'Crudo'])
    const priced = price(
      [
        product(yerbaCanarias.id, 1),
        combo(1, { options: null }),
        combo(1, { options: { leather: 'Marrón' } }),
      ],
      products,
    )

    expect(priced.optionErrors).toEqual([
      { field: 'items.1.options', code: 'required', message: 'Elegí el color del mate.' },
      {
        field: 'items.2.options.leather',
        code: 'leather_not_offered',
        message: 'Ese color no está disponible para este mate.',
      },
    ])
  })

  it('un combo con un mate sin cueros ignora el cuero; la clave repite lo que mandó la tienda', () => {
    const products = imperialWith([])
    const priced = price([combo(1)], products)

    expect(priced.quote.lines[0]).toMatchObject({
      key: 'combo:cmb-duo-imperial:Marrón',
      detail: 'Mate Imperial Premium + Bombillón Premium Curvo',
    })
    expect(priced.lines[0]?.options).toBeNull()
    expect(priced.optionErrors).toEqual([])
  })

  it('un combo sin mate ignora el cuero, pero la clave repite lo que mandó la tienda', () => {
    const priced = price([
      combo(1, { comboId: bombillaYerba.id, options: { leather: 'Crudo' } }),
      combo(1, { comboId: bombillaYerba.id, options: null }),
    ])

    expect(priced.quote.lines[1]?.key).toBe('combo:cmb-bombilla-y-yerba:-')
    expect(priced.quote.lines[0]).toMatchObject({
      key: 'combo:cmb-bombilla-y-yerba:Crudo',
      name: 'Bombilla y yerba',
      detail: 'Bombillón 100% Alpaca + Yerba Canarias 1 kg',
      unitPriceArs: 35998,
      kitSavingsArs: 3999,
      totalArs: 31999,
      issue: null,
    })
    expect(priced.lines[0]).toMatchObject({ options: null, productSlug: null })
    expect(priced.lines[0]?.kitItems).toHaveLength(2)
    expect(priced.optionErrors).toEqual([])
  })

  it('si las piezas suman menos que el combo, se cobra el combo sin ahorro', () => {
    const cheaper = productMap([
      { ...imperialPremium, priceArs: 30000 },
      { ...bombillonCurvo, priceArs: 20000 },
    ])

    expect(price([combo(2)], cheaper).quote.lines[0]).toMatchObject({
      unitPriceArs: 61999,
      kitSavingsArs: 0,
      totalArs: 123998,
    })
  })

  it('sin stock de una pieza sale sold_out; con menos, quantity_reduced con la pieza que limita', () => {
    const soldOut = price(
      [combo(1)],
      productMap(),
      PRICING_SETTINGS,
      comboMap([{ ...galletaCanarias, id: duoImperial.id, status: 'published' }]),
    )
    const reduced = price(
      [combo(5)],
      productMap([imperialPremium, { ...bombillonCurvo, available: 3 }]),
    )

    expect(soldOut.quote.lines[0]).toMatchObject({ issue: 'sold_out', totalArs: 0 })
    expect(soldOut.stockChanges).toEqual([
      { kind: 'stock', productId: galleta.id, message: 'Galleta y Canarias se agotó.' },
    ])
    expect(reduced.quote.lines[0]).toMatchObject({
      issue: 'quantity_reduced',
      maxQuantity: 3,
      totalArs: 185997,
    })
    expect(reduced.stockChanges).toEqual([
      {
        kind: 'stock',
        productId: bombillonCurvo.id,
        message: 'Quedan 3 unidades de Dúo Imperial.',
      },
    ])
    expect(reduced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 3 },
      { productId: bombillonCurvo.id, quantity: 3 },
    ])
  })

  it('Review Focus 1: el combo × 10 y el mate suelto × 5 comparten las 12 del mate', () => {
    const priced = price([combo(10), mate(5)])

    expect(priced.quote.lines.map((line) => [line.issue, line.maxQuantity])).toEqual([
      [null, 12],
      ['quantity_reduced', 2],
    ])
    expect(priced.stockChanges).toEqual([
      {
        kind: 'stock',
        productId: imperialPremium.id,
        message: 'Quedan 2 unidades de Mate Imperial Premium.',
      },
    ])
    expect(priced.reservation).toEqual([
      { productId: imperialPremium.id, quantity: 12 },
      { productId: bombillonCurvo.id, quantity: 10 },
    ])
  })

  it('Review Focus 4: un combo [yerba, mate] respeta ese orden en detail y en las piezas', () => {
    const yerbaMate: PricedCombo = {
      ...duoImperial,
      name: 'Yerba y mate',
      priceArs: 45999,
      productIds: [yerbaCanarias.id, imperialPremium.id],
    }
    const options = { leather: 'Negro' } as const
    const priced = price(
      [combo(1, { options })],
      productMap(),
      PRICING_SETTINGS,
      comboMap([yerbaMate]),
    )

    expect(priced.quote.lines[0]?.detail).toBe(
      'Yerba Canarias 1 kg + Mate Imperial Premium · Color negro',
    )
    expect(priced.lines[0]?.kitItems?.map((piece) => [piece.position, piece.role])).toEqual([
      [1, 'yerba'],
      [2, 'mate'],
    ])
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
