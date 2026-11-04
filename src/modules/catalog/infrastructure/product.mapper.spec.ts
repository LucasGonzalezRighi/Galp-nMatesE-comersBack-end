import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ProductRow, toProduct } from './product.mapper'

/** Fila de `products` con sus relaciones (solo las columnas que lee el mapper). */
function productRow(overrides: Partial<Omit<ProductRow, 'category'>> & { group?: string }) {
  const { group = 'mate', ...columns } = overrides
  return {
    id: 'p1',
    sequence: 1,
    slug: 'mate-imperial-premium',
    name: 'Mate Imperial Premium',
    description: 'Calabaza con virola de alpaca.',
    priceArs: 12100,
    status: 'published',
    featured: false,
    category: { id: 'c1', slug: 'imperiales', name: 'Imperiales', group },
    images: [],
    inventory: { onHand: 3, reserved: 0 },
    tabsOverride: null,
    reviews: [],
    leathers: ['Borravino', 'Negro'],
    ...columns,
  } as unknown as ProductRow
}

describe('toProduct', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('un mate conserva sus cueros guardados, en el orden canónico', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    expect(toProduct(productRow({})).leathers()).toEqual(['Negro', 'Borravino'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('un producto que no es mate con cueros guardados se lee sin cueros y avisa con un warn', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const row = productRow({ slug: 'bombillon-pico-de-loro', group: 'bombilla' })

    const product = toProduct(row)

    expect(product.leathers()).toEqual([])
    expect(product.slug).toBe('bombillon-pico-de-loro')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('bombillon-pico-de-loro')
  })

  it('un no-mate sin cueros no avisa', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    expect(toProduct(productRow({ group: 'yerba', leathers: [] })).leathers()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })
})
