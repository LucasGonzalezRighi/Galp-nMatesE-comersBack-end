import { UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { createValidationPipe } from '../../../../shared/infrastructure/http/validation.pipe'
import { AdminProductInputDto } from './admin-product-input.dto'
import { AdminProductsQueryDto } from './admin-products.query.dto'

const pipe = createValidationPipe()

/** Producto válido como lo manda el dashboard. */
const BODY = {
  name: 'Mate Imperial',
  slug: 'mate-imperial',
  categoryId: 'cat-mates',
  description: 'Mate de calabaza forrado en cuero.',
  priceArs: 39999,
  stock: 12,
  featured: false,
  status: 'draft',
  images: [],
  leathers: ['Borravino', 'Negro'],
}

/** Pasa el cuerpo por el pipe global; devuelve el DTO o los errores del 422. */
async function product(body: Record<string, unknown>): Promise<AdminProductInputDto | unknown[]> {
  try {
    return (await pipe.transform(body, {
      type: 'body',
      metatype: AdminProductInputDto,
    })) as AdminProductInputDto
  } catch (error) {
    if (error instanceof UnprocessableEntityException) {
      return (error.getResponse() as { errors: unknown[] }).errors
    }
    throw error
  }
}

describe('AdminProductInputDto', () => {
  it('deja los cueros en el orden de Leather y las pestañas sin texto en null', async () => {
    const dto = await product({ ...BODY, tabsOverride: { materials: '  ', care: null } })
    expect(dto).toBeInstanceOf(AdminProductInputDto)
    const fields = (dto as AdminProductInputDto).toFields()
    expect(fields.leathers).toEqual(['Negro', 'Borravino'])
    expect(fields.tabsOverride).toBeNull()
  })

  it('una pestaña que falta usa la del grupo (como el mock) y la otra queda recortada', async () => {
    const dto = (await product({
      ...BODY,
      tabsOverride: { care: ' Lavalo con agua tibia. ' },
    })) as AdminProductInputDto
    expect(dto.toFields().tabsOverride).toEqual({
      materials: null,
      care: 'Lavalo con agua tibia.',
    })
  })

  it('expectedUpdatedAt tiene que ser una fecha ISO con zona', async () => {
    expect(await product({ ...BODY, expectedUpdatedAt: '2026-10-15' })).toEqual([
      {
        field: 'expectedUpdatedAt',
        code: 'invalid_format',
        message: 'La fecha de la última modificación no es válida.',
      },
    ])
    const dto = await product({ ...BODY, expectedUpdatedAt: '2026-10-15T18:30:00.123Z' })
    expect(dto).toBeInstanceOf(AdminProductInputDto)
  })
})

describe('AdminProductsQueryDto', () => {
  async function query(raw: Record<string, unknown>): Promise<unknown> {
    try {
      const dto = (await pipe.transform(raw, {
        type: 'query',
        metatype: AdminProductsQueryDto,
      })) as AdminProductsQueryDto
      return dto.toQuery()
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        return (error.getResponse() as { errors: unknown[] }).errors
      }
      throw error
    }
  }

  it('vacío cuenta como ausente y repetido toma el primero', async () => {
    expect(await query({ page: '', pageSize: '', status: '', q: ['mate', 'otro'] })).toEqual({
      q: 'mate',
      category: undefined,
      status: undefined,
      stock: undefined,
      sort: undefined,
      page: 1,
      pageSize: 24,
    })
  })

  it('un entero raro da solo el error de tipo, como el mock', async () => {
    expect(await query({ page: '1.5', pageSize: '1e2' })).toEqual([
      { field: 'page', code: 'invalid_type', message: 'La página tiene que ser un número entero.' },
      {
        field: 'pageSize',
        code: 'invalid_type',
        message: 'El tamaño de página tiene que ser un número entero.',
      },
    ])
  })
})
