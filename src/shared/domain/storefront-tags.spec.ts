import { describe, expect, it } from 'vitest'

import {
  STOREFRONT_AGGREGATE,
  STOREFRONT_MAX_TAGS,
  STOREFRONT_STALE_EVENT,
  STOREFRONT_TAG_PATTERN,
  storefrontStaleEvent,
} from './storefront-tags'

describe('storefrontStaleEvent', () => {
  it('arma el evento storefront.stale con el reason como agregado y sin etiquetas repetidas', () => {
    expect(storefrontStaleEvent('content.updated', ['content:home', 'content:home'])).toEqual({
      type: 'storefront.stale',
      aggregateType: 'storefront',
      aggregateId: 'content.updated',
      payload: { reason: 'content.updated', tags: ['content:home'] },
    })
  })

  it('respeta el orden en que llegan las etiquetas', () => {
    const tags = ['products', 'product:mate-nuevo', 'product:mate-viejo', 'categories', 'combos']

    expect(storefrontStaleEvent('product.updated', tags).payload.tags).toEqual(tags)
  })

  it('acepta las etiquetas de todas las escrituras del dashboard', () => {
    const tags = [
      'settings',
      'reviews:featured',
      'reviews:mate-imperial-premium',
      'content:legal-terms',
    ]

    expect(storefrontStaleEvent('x', tags).payload.tags).toEqual(tags)
  })

  it('sin etiquetas tira RangeError', () => {
    expect(() => storefrontStaleEvent('content.updated', [])).toThrow(RangeError)
  })

  it('una etiqueta que la tienda rechazaría tira RangeError', () => {
    expect(() => storefrontStaleEvent('content.updated', ['content:Home'])).toThrow(RangeError)
    expect(() => storefrontStaleEvent('content.updated', ['products '])).toThrow(RangeError)
  })

  it('más de 50 etiquetas distintas tira RangeError', () => {
    const tags = Array.from({ length: 51 }, (_, i) => `product:mate-${String(i)}`)

    expect(() => storefrontStaleEvent('product.updated', tags)).toThrow(RangeError)
    expect(storefrontStaleEvent('product.updated', tags.slice(0, 50)).payload.tags).toHaveLength(50)
  })

  it('un reason vacío tira TypeError', () => {
    expect(() => storefrontStaleEvent('', ['products'])).toThrow(TypeError)
    expect(() => storefrontStaleEvent('   ', ['products'])).toThrow(TypeError)
  })

  it('las constantes son las del aviso a la tienda', () => {
    expect(STOREFRONT_STALE_EVENT).toBe('storefront.stale')
    expect(STOREFRONT_AGGREGATE).toBe('storefront')
    expect(STOREFRONT_MAX_TAGS).toBe(50)
  })
})

describe('STOREFRONT_TAG_PATTERN', () => {
  it.each([
    'combos',
    'products',
    'categories',
    'settings',
    'product:mate-imperial-premium',
    'reviews:featured',
    'content:legal-terms',
  ])('acepta %s', (tag) => {
    expect(STOREFRONT_TAG_PATTERN.test(tag)).toBe(true)
  })

  it.each(['../x', 'product:Mate', 'combos ', '', 'content:home2'])('rechaza "%s"', (tag) => {
    expect(STOREFRONT_TAG_PATTERN.test(tag)).toBe(false)
  })
})
