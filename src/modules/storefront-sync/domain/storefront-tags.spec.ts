import { describe, expect, it } from 'vitest'

import { STOREFRONT_EVENT_TYPES, storefrontTagsFor } from './storefront-tags'

describe('storefrontTagsFor', () => {
  it('combo.changed regenera la etiqueta combos', () => {
    expect(storefrontTagsFor('combo.changed', { comboId: null, change: 'reordered' })).toEqual([
      'combos',
    ])
  })

  it('storefront.stale regenera las etiquetas que trae, en su orden', () => {
    expect(
      storefrontTagsFor('storefront.stale', { reason: 'x', tags: ['products', 'combos'] }),
    ).toEqual(['products', 'combos'])
  })

  it('storefront.stale sin lista de etiquetas no regenera nada', () => {
    expect(storefrontTagsFor('storefront.stale', { reason: 'x' })).toEqual([])
    expect(storefrontTagsFor('storefront.stale', { reason: 'x', tags: 'products' })).toEqual([])
    expect(storefrontTagsFor('storefront.stale', null)).toEqual([])
  })

  it('storefront.stale descarta repetidas y lo que la tienda rechazaría', () => {
    expect(
      storefrontTagsFor('storefront.stale', {
        reason: 'x',
        tags: ['products', 'products', 'product:Mate', 3, 'combos'],
      }),
    ).toEqual(['products', 'combos'])
  })

  it('un tipo desconocido no regenera nada', () => {
    expect(storefrontTagsFor('order.created', {})).toEqual([])
    expect(storefrontTagsFor('constructor', {})).toEqual([])
  })

  it('los tipos que mapea son los que se registran en el outbox', () => {
    expect(STOREFRONT_EVENT_TYPES).toEqual(['combo.changed', 'storefront.stale'])
  })
})
