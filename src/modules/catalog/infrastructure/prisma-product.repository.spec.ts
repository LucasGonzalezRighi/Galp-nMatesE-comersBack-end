import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ProductFilter } from '../application/ports/product.repository.port'
import { PrismaProductRepository } from './prisma-product.repository'

/** Consulta cruda que recibió el cliente falso: el SQL con `?` por parámetro y sus valores. */
interface RawQuery {
  sql: string
  values: unknown[]
}

/** Cliente de Prisma falso (sin base) que anota cada consulta cruda y cuenta `total` filas. */
function fakePrisma(total: number) {
  const queries: RawQuery[] = []
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    queries.push({ sql, values })
    return Promise.resolve(sql.includes('count(*)') ? [{ total }] : [])
  })
  const findMany = vi.fn(() => Promise.resolve([]))
  const prisma = { $queryRaw: queryRaw, product: { findMany } } as unknown as PrismaService
  return { repository: new PrismaProductRepository(prisma), queries, findMany }
}

const FILTER: ProductFilter = { sort: 'destacados', page: 1, pageSize: 24 }

describe('PrismaProductRepository.list', () => {
  it('pagina con el desplazamiento como bigint: entra aunque pase de un int de 32 bits', async () => {
    const { repository, queries } = fakePrisma(27)

    const list = await repository.list({ ...FILTER, page: 90_000_000 })

    const pageQuery = queries.find(({ sql }) => sql.includes('OFFSET'))
    expect(pageQuery?.sql).toMatch(/OFFSET \?::bigint/)
    expect(pageQuery?.values).toContain(89_999_999 * 24)
    expect(list).toEqual({ items: [], total: 27 })
  })

  it('devuelve una página vacía con el total real si el desplazamiento no es un entero seguro', async () => {
    const { repository, queries, findMany } = fakePrisma(27)

    const list = await repository.list({ ...FILTER, page: Number.MAX_SAFE_INTEGER, pageSize: 100 })

    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('count(*)')
    expect(findMany).not.toHaveBeenCalled()
    expect(list).toEqual({ items: [], total: 27 })
  })

  it('no consulta la base con un NUL en la búsqueda o la línea: Postgres lo rechazaría', async () => {
    const { repository, queries } = fakePrisma(27)

    expect(await repository.list({ ...FILTER, q: '\u0000' })).toEqual({ items: [], total: 0 })
    expect(await repository.list({ ...FILTER, q: 'mate\u0000' })).toEqual({ items: [], total: 0 })
    expect(await repository.list({ ...FILTER, category: 'torpedos\u0000' })).toEqual({
      items: [],
      total: 0,
    })
    expect(queries).toHaveLength(0)
  })
})
