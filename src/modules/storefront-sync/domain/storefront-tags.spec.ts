import { describe, expect, it } from 'vitest'

import {
  STOREFRONT_EVENT_TYPES,
  STOREFRONT_MAX_TAGS,
  STOREFRONT_TAG_PATTERN,
  storefrontTagsFor,
} from './storefront-tags'

describe('storefrontTagsFor', () => {
  it('combo.changed regenera la etiqueta combos', () => {
    expect(storefrontTagsFor('combo.changed', { comboId: null, change: 'reordered' })).toEqual([
      'combos',
    ])
  })

  it('un tipo desconocido no regenera nada', () => {
    expect(storefrontTagsFor('order.created', {})).toEqual([])
    expect(storefrontTagsFor('constructor', {})).toEqual([])
  })

  it('los tipos que mapea son los que se registran en el outbox', () => {
    expect(STOREFRONT_EVENT_TYPES).toEqual(['combo.changed'])
  })
})

describe('STOREFRONT_TAG_PATTERN', () => {
  it.each(['combos', 'products', 'product:mate-imperial-premium', 'content:legal-terms'])(
    'acepta %s',
    (tag) => {
      expect(STOREFRONT_TAG_PATTERN.test(tag)).toBe(true)
    },
  )

  it.each(['../x', 'product:Mate', 'combos ', ''])('rechaza "%s"', (tag) => {
    expect(STOREFRONT_TAG_PATTERN.test(tag)).toBe(false)
  })

  it('la tienda acepta hasta 50 etiquetas por pedido', () => {
    expect(STOREFRONT_MAX_TAGS).toBe(50)
  })
})
