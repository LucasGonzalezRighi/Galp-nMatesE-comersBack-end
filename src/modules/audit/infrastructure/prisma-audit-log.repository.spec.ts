import { describe, expect, it, vi } from 'vitest'

import { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { ADMIN_WRITE_DESCRIPTORS, type SnapshotSource } from '../domain/admin-write'
import { PrismaAuditLogRepository } from './prisma-audit-log.repository'

const UUID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

const CATEGORIES: SnapshotSource = {
  table: 'categories',
  keyColumn: 'id',
  keyType: 'uuid',
  personalData: false,
}
const ORDERS: SnapshotSource = {
  table: 'orders',
  keyColumn: 'number',
  keyType: 'text',
  personalData: true,
}
const SETTINGS: SnapshotSource = {
  table: 'settings',
  keyColumn: 'id',
  keyType: 'integer',
  personalData: false,
}

/** Cliente de Prisma falso (sin base): anota las consultas crudas ya armadas y las altas. */
function fakePrisma(rows: unknown[] = []) {
  const queries: Prisma.Sql[] = []
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(Prisma.sql(strings, ...values))
    return Promise.resolve(rows)
  })
  const create = vi.fn<(args: unknown) => Promise<object>>(() => Promise.resolve({}))
  const prisma = { $queryRaw: queryRaw, auditLog: { create } } as unknown as PrismaService
  return { repository: new PrismaAuditLogRepository(prisma), queries, create }
}

/** El SQL de una consulta en una línea, con `$n` por parámetro. */
function textOf(query: Prisma.Sql | undefined): string {
  return (query?.text ?? '').replace(/\s+/g, ' ').trim()
}

describe('PrismaAuditLogRepository.readRow', () => {
  it('lee la fila como JSON: tabla y columna del descriptor entre comillas y el id como parámetro', async () => {
    const row = { id: UUID, name: 'Imperiales' }
    const { repository, queries } = fakePrisma([{ row }])

    const found = await repository.readRow(CATEGORIES, UUID)

    expect(found).toEqual(row)
    expect(queries).toHaveLength(1)
    expect(textOf(queries[0])).toBe(
      'SELECT to_jsonb(t) AS "row" FROM "categories" AS t WHERE t."id" = $1::uuid LIMIT 1',
    )
    expect(queries[0]?.values).toEqual([UUID])
  })

  it('compara con el tipo de la columna clave: texto y entero', async () => {
    const { repository, queries } = fakePrisma()

    await repository.readRow(ORDERS, 'GLP-10001')
    await repository.readRow(SETTINGS, '1')

    expect(queries.map(textOf)).toEqual([
      'SELECT to_jsonb(t) AS "row" FROM "orders" AS t WHERE t."number" = $1::text LIMIT 1',
      'SELECT to_jsonb(t) AS "row" FROM "settings" AS t WHERE t."id" = $1::integer LIMIT 1',
    ])
    expect(queries.map((query) => query.values)).toEqual([['GLP-10001'], ['1']])
  })

  it('un id con comillas o con SQL viaja como parámetro, nunca en el texto de la consulta', async () => {
    const { repository, queries } = fakePrisma()
    const hostile = `GLP-1'; DROP TABLE orders; --`

    expect(await repository.readRow(ORDERS, hostile)).toBeNull()

    expect(textOf(queries[0])).not.toContain('DROP')
    expect(queries[0]?.values).toEqual([hostile])
  })

  it('si la fila no existe devuelve null', async () => {
    const { repository } = fakePrisma([])

    expect(await repository.readRow(CATEGORIES, UUID)).toBeNull()
  })

  it.each([
    ['uuid', CATEGORIES, 'cat-imperiales'],
    ['uuid', CATEGORIES, ''],
    ['uuid', CATEGORIES, `${UUID}'`],
    ['entero', SETTINGS, '1 OR 1=1'],
    ['entero', SETTINGS, '-1'],
    ['entero', SETTINGS, '99999999999'],
    ['texto', ORDERS, 'GLP-1\u0000'],
    ['texto', ORDERS, 'x'.repeat(201)],
  ])(
    'un id que no tiene forma de %s no lanza ni consulta: no hay fila',
    async (_type, source, id) => {
      const { repository, queries } = fakePrisma([{ row: { id } }])

      expect(await repository.readRow(source, id)).toBeNull()
      expect(queries).toEqual([])
    },
  )

  it('acepta un UUID en mayúsculas', async () => {
    const { repository, queries } = fakePrisma()

    await repository.readRow(CATEGORIES, UUID.toUpperCase())

    expect(queries[0]?.values).toEqual([UUID.toUpperCase()])
  })

  it.each(['categories; DROP TABLE users', 'Categories', 'public.categories', 'a"b', ''])(
    'rechaza un nombre de tabla o de columna que no es un identificador simple (%j)',
    async (name) => {
      const { repository, queries } = fakePrisma()

      await expect(repository.readRow({ ...CATEGORIES, table: name }, UUID)).rejects.toThrow(
        TypeError,
      )
      await expect(repository.readRow({ ...CATEGORIES, keyColumn: name }, UUID)).rejects.toThrow(
        /no es un nombre de tabla o de columna/,
      )
      expect(queries).toEqual([])
    },
  )

  it('arma una consulta válida para cada foto de la tabla de descriptores', async () => {
    const { repository, queries } = fakePrisma()
    const ids = { uuid: UUID, text: 'GLP-10001', integer: '1' }
    const sources = ADMIN_WRITE_DESCRIPTORS.flatMap(({ target }) =>
      target.snapshot === null ? [] : [target.snapshot],
    )

    for (const source of sources) await repository.readRow(source, ids[source.keyType])

    expect(queries).toHaveLength(sources.length)
    expect(new Set(queries.map((query) => /FROM "([a-z_]+)"/.exec(query.text)?.[1]))).toEqual(
      new Set([
        'categories',
        'combos',
        'products',
        'content_blocks',
        'orders',
        'reviews',
        'settings',
        'contact_messages',
      ]),
    )
  })
})

describe('PrismaAuditLogRepository.append', () => {
  it('guarda quién, qué, sobre qué y los cambios como JSON puro', async () => {
    const { repository, create } = fakePrisma()

    await repository.append({
      actorUserId: UUID,
      action: 'category.reorder',
      entityType: 'category',
      entityId: null,
      changes: { input: { ids: ['a'], skipped: undefined }, before: null, after: { n: 1 } },
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: UUID,
        action: 'category.reorder',
        entityType: 'category',
        entityId: null,
        changes: { input: { ids: ['a'] }, before: null, after: { n: 1 } },
      },
    })
    const [args] = create.mock.calls[0] ?? []
    expect(JSON.stringify(args)).not.toContain('skipped')
  })
})
