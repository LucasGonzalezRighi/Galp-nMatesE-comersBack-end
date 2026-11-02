import { describe, expect, it } from 'vitest'

import {
  MAX_QUANTITY_PER_PRODUCT,
  Product,
  type ProductProps,
  selectRelated,
} from './product.entity'

/** Producto publicado válido, con lo que cada test quiera pisar. */
function productProps(overrides: Partial<ProductProps> = {}): ProductProps {
  return {
    id: 'p1',
    sequence: 1,
    slug: 'mate-imperial-premium',
    name: 'Mate Imperial Premium',
    description: 'Calabaza con virola de alpaca.',
    priceArs: 12100,
    status: 'published',
    featured: true,
    category: { id: 'c1', slug: 'imperiales', name: 'Imperiales', group: 'mate' },
    images: [
      { publicId: 'galpon/a', url: '/a.jpg', width: 960, height: 1280, alt: 'Foto A' },
      { publicId: 'galpon/b', url: '/b.jpg', width: 960, height: 1280, alt: 'Foto B' },
    ],
    inventory: { onHand: 12, reserved: 0 },
    tabsOverride: null,
    rating: { average: 14 / 3, count: 3 },
    ...overrides,
  }
}

describe('Product', () => {
  it('arma el código con N° y al menos dos dígitos', () => {
    expect(Product.create(productProps()).code()).toBe('N°01')
    expect(Product.create(productProps({ sequence: 123 })).code()).toBe('N°123')
  })

  it('se puede comprar si está publicado, tiene precio y hay disponible', () => {
    expect(Product.create(productProps()).isPurchasable()).toBe(true)
    expect(Product.create(productProps({ status: 'draft' })).isPurchasable()).toBe(false)
    expect(Product.create(productProps({ priceArs: null })).isPurchasable()).toBe(false)
    const reservedAll = Product.create(productProps({ inventory: { onHand: 3, reserved: 3 } }))
    expect(reservedAll.isPurchasable()).toBe(false)
    expect(reservedAll.isSoldOut()).toBe(true)
  })

  it('limita la cantidad máxima al disponible y a 20', () => {
    expect(Product.create(productProps()).maxQuantity()).toBe(12)
    expect(
      Product.create(productProps({ inventory: { onHand: 50, reserved: 5 } })).maxQuantity(),
    ).toBe(MAX_QUANTITY_PER_PRODUCT)
    expect(
      Product.create(productProps({ inventory: { onHand: 2, reserved: 0 } })).isSoldOut(),
    ).toBe(false)
  })

  it('calcula el precio sin IVA redondeado al peso, o null si es "a consultar"', () => {
    expect(Product.create(productProps()).netPriceArs(21)).toBe(10000)
    expect(Product.create(productProps({ priceArs: 39999 })).netPriceArs(21)).toBe(33057)
    expect(Product.create(productProps({ priceArs: null })).netPriceArs(21)).toBeNull()
    expect(() => Product.create(productProps()).netPriceArs(101)).toThrow(RangeError)
  })

  it('ofrece cueros y virolas solo en los mates', () => {
    expect(Product.create(productProps()).options()).toEqual({
      leathers: ['Negro', 'Marrón', 'Crudo', 'Borravino'],
      ferrules: ['Alpaca lisa', 'Alpaca cincelada', 'Acero'],
    })
    const bombilla = productProps({
      category: { id: 'c2', slug: 'bombillones', name: 'Bombillones', group: 'bombilla' },
    })
    expect(Product.create(bombilla).options()).toBeNull()
  })

  it('usa la primera foto como principal y null sin fotos', () => {
    expect(Product.create(productProps()).mainImage()?.publicId).toBe('galpon/a')
    expect(Product.create(productProps({ images: [] })).mainImage()).toBeNull()
  })

  it('vuelve a crearse igual desde sus props (lo que guarda la caché)', () => {
    const product = Product.create(productProps())
    const copy = Product.create(JSON.parse(JSON.stringify(product.toProps())) as ProductProps)
    expect(copy.toProps()).toEqual(product.toProps())
  })

  it('valida las props con errores en español', () => {
    expect(() => Product.create(productProps({ sequence: 0 }))).toThrow(/correlativo/)
    expect(() => Product.create(productProps({ priceArs: -1 }))).toThrow(RangeError)
    expect(() => Product.create(productProps({ slug: '' }))).toThrow(/slug/)
    expect(() => Product.create(productProps({ rating: { average: 6, count: 1 } }))).toThrow(
      /promedio/,
    )
    expect(() => Product.create(productProps({ inventory: { onHand: 1, reserved: 2 } }))).toThrow(
      /reservado/,
    )
  })
})

describe('selectRelated', () => {
  /** Producto mínimo para elegir relacionados. */
  function item(id: string, categoryId: string, group: 'mate' | 'bombilla' | 'yerba') {
    return { id, categoryId, group }
  }

  it('pone primero los de la misma línea y después los del mismo grupo, sin el propio', () => {
    const product = item('a', 'imperiales', 'mate')
    const catalog = [
      product,
      item('b', 'torpedos', 'mate'),
      item('c', 'imperiales', 'mate'),
      item('d', 'bombillones', 'bombilla'),
      item('e', 'imperiales', 'mate'),
      item('f', 'camioneros', 'mate'),
      item('g', 'torpedos', 'mate'),
    ]
    expect(selectRelated(product, catalog, 4).map(({ id }) => id)).toEqual(['c', 'e', 'b', 'f'])
  })

  it('nunca incluye otro grupo y acepta un límite de 0', () => {
    const product = item('a', 'yerbas', 'yerba')
    const catalog = [product, item('b', 'bombillones', 'bombilla')]
    expect(selectRelated(product, catalog, 4)).toEqual([])
    expect(selectRelated(product, [product, item('c', 'yerbas', 'yerba')], 0)).toEqual([])
  })
})
