import { describe, expect, it } from 'vitest'

import {
  CatalogValidationError,
  CategoryHasProductsError,
  CategoryNotFoundError,
  ProductChangedError,
  ProductNotFoundError,
  SlugTakenError,
} from './catalog-admin-errors'
import {
  categoryStorefrontEvent,
  type ProductChangeReason,
  productStorefrontEvent,
  publishedAtAfterSave,
} from './catalog-admin-events'

describe('errores del dashboard del catálogo', () => {
  it('tienen el type, el título y el detail del mock', () => {
    expect(new ProductNotFoundError()).toMatchObject({
      code: 'not_found',
      status: 404,
      detail: 'No existe ese producto.',
    })
    expect(new CategoryNotFoundError()).toMatchObject({
      status: 404,
      detail: 'No existe esa línea.',
    })
    expect(new SlugTakenError('mate-imperial-premium')).toMatchObject({
      code: 'slug_taken',
      status: 409,
      title: 'El slug ya está en uso',
      detail: 'Ya hay algo con el slug mate-imperial-premium.',
    })
    expect(new ProductChangedError()).toMatchObject({ code: 'product_changed', status: 409 })
    expect(new CategoryHasProductsError()).toMatchObject({
      code: 'category_has_products',
      status: 409,
    })
    expect(() => new SlugTakenError(' ')).toThrow(TypeError)
    expect(() => new CatalogValidationError([])).toThrow(TypeError)
  })
})

describe('avisos a la tienda del dashboard del catálogo', () => {
  it('un producto avisa products, su slug, el anterior si cambió, categories y combos', () => {
    expect(productStorefrontEvent('product.updated', 'mate-nuevo', 'mate-viejo').payload).toEqual({
      reason: 'product.updated',
      tags: ['products', 'product:mate-nuevo', 'product:mate-viejo', 'categories', 'combos'],
    })
    expect(productStorefrontEvent('product.created', 'mate-nuevo', 'mate-nuevo').payload).toEqual({
      reason: 'product.created',
      tags: ['products', 'product:mate-nuevo', 'categories', 'combos'],
    })
    expect(() =>
      productStorefrontEvent('product.deleted' as ProductChangeReason, 'a', null),
    ).toThrow(RangeError)
  })

  it('una línea avisa categories y products', () => {
    expect(categoryStorefrontEvent('category.reordered')).toMatchObject({
      type: 'storefront.stale',
      aggregateId: 'category.reordered',
      payload: { reason: 'category.reordered', tags: ['categories', 'products'] },
    })
  })

  it('publishedAt se pone en la primera publicación y se conserva', () => {
    const now = new Date('2026-11-04T12:00:00.000Z')
    const before = new Date('2026-08-01T12:00:00.000Z')
    expect(publishedAtAfterSave(null, 'published', now)).toEqual(now)
    expect(publishedAtAfterSave(null, 'draft', now)).toBeNull()
    expect(publishedAtAfterSave(before, 'published', now)).toEqual(before)
    expect(publishedAtAfterSave(before, 'draft', now)).toEqual(before)
  })
})
