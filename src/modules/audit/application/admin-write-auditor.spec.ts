import { describe, expect, it } from 'vitest'

import {
  type AdminWriteTarget,
  resolveAdminWrite,
  type SnapshotSource,
} from '../domain/admin-write'
import { type JsonRow, MAX_INPUT_BYTES } from '../domain/audit-changes'
import { type AdminWrite, AdminWriteAuditor } from './admin-write-auditor'
import type { AuditLogRepository, NewAuditEntry } from './ports/audit-log.repository.port'

const ADMIN = '0190a1b2-c3d4-7e5f-8a9b-000000000001'
const CATEGORY_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

/** Error de la base con un mensaje que no puede llegar al log (trae datos del pedido). */
class DatabaseDown extends Error {
  override readonly name = 'DatabaseDown'
  readonly code = 'P1001'

  constructor() {
    super('No responde: {"name":"Secreto del cuerpo"}')
  }
}

/** Base en memoria: las filas por `tabla/id` y las filas de auditoría guardadas. */
class FakeAuditLog implements AuditLogRepository {
  readonly rows = new Map<string, JsonRow>()
  readonly reads: string[] = []
  readonly entries: NewAuditEntry[] = []
  /** Lecturas que fallan, por número de lectura (1 es la primera). */
  failingReads = new Set<number>()
  failAppend = false

  set(table: string, id: string, row: JsonRow | null): void {
    if (row === null) this.rows.delete(`${table}/${id}`)
    else this.rows.set(`${table}/${id}`, row)
  }

  readRow(source: SnapshotSource, id: string): Promise<JsonRow | null> {
    this.reads.push(`${source.table}.${source.keyColumn}=${id}`)
    if (this.failingReads.has(this.reads.length)) return Promise.reject(new DatabaseDown())
    return Promise.resolve(this.rows.get(`${source.table}/${id}`) ?? null)
  }

  append(entry: NewAuditEntry): Promise<void> {
    if (this.failAppend) return Promise.reject(new DatabaseDown())
    this.entries.push(entry)
    return Promise.resolve()
  }
}

/** Log en memoria. */
class FakeLog {
  readonly errors: string[] = []

  error(message: string): void {
    this.errors.push(message)
  }
}

function target(method: string, path: string): AdminWriteTarget {
  const resolved = resolveAdminWrite(method, path)
  if (resolved === null) throw new Error(`${method} ${path} no se audita`)
  return resolved
}

function setup() {
  const auditLog = new FakeAuditLog()
  const log = new FakeLog()
  return { auditLog, log, auditor: new AdminWriteAuditor(auditLog, log) }
}

function write(
  method: string,
  path: string,
  params: Record<string, unknown> = {},
  body?: unknown,
): AdminWrite {
  return { target: target(method, path), actorUserId: ADMIN, params, body }
}

const CATEGORY = {
  id: CATEGORY_ID,
  slug: 'imperiales',
  name: 'Imperiales',
  position: 1,
  updated_at: '2026-11-01T10:00:00.000+00:00',
}

describe('AdminWriteAuditor', () => {
  it('una edición: lee la fila antes y después y guarda quién, qué, sobre qué y las columnas que cambiaron', async () => {
    const { auditLog, log, auditor } = setup()
    auditLog.set('categories', CATEGORY_ID, CATEGORY)
    const body = { name: 'Imperiales premium', slug: 'imperiales' }

    const pending = await auditor.begin(
      write('PATCH', 'admin/categories/:id', { id: CATEGORY_ID }, body),
    )
    expect(auditLog.reads).toEqual([`categories.id=${CATEGORY_ID}`])
    expect(auditLog.entries).toEqual([])
    auditLog.set('categories', CATEGORY_ID, {
      ...CATEGORY,
      name: 'Imperiales premium',
      updated_at: '2026-11-17T12:00:00.000+00:00',
    })
    await auditor.complete(pending, { id: CATEGORY_ID, name: 'Imperiales premium' })

    expect(auditLog.reads).toHaveLength(2)
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'category.update',
        entityType: 'category',
        entityId: CATEGORY_ID,
        changes: {
          input: body,
          before: { name: 'Imperiales' },
          after: { name: 'Imperiales premium' },
        },
      },
    ])
    expect(log.errors).toEqual([])
  })

  it('un alta: el id sale de la respuesta, before es null y after la fila entera', async () => {
    const { auditLog, auditor } = setup()
    const body = { name: 'Imperiales', slug: 'imperiales' }

    const pending = await auditor.begin(write('POST', 'admin/categories', {}, body))
    expect(auditLog.reads).toEqual([])
    auditLog.set('categories', CATEGORY_ID, CATEGORY)
    await auditor.complete(pending, { id: CATEGORY_ID, name: 'Imperiales' })

    expect(auditLog.reads).toEqual([`categories.id=${CATEGORY_ID}`])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'category.create',
        entityType: 'category',
        entityId: CATEGORY_ID,
        changes: { input: body, before: null, after: CATEGORY },
      },
    ])
  })

  it('un borrado: la fila entera en before, after null y sin input', async () => {
    const { auditLog, auditor } = setup()
    auditLog.set('categories', CATEGORY_ID, CATEGORY)

    const pending = await auditor.begin(
      write('DELETE', 'admin/categories/:id', { id: CATEGORY_ID }),
    )
    auditLog.set('categories', CATEGORY_ID, null)
    await auditor.complete(pending, undefined)

    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'category.delete',
        entityType: 'category',
        entityId: CATEGORY_ID,
        changes: { before: CATEGORY, after: null },
      },
    ])
  })

  it('reordenar: solo lo que mandó el dashboard, sin entidad y sin leer nada', async () => {
    const { auditLog, auditor } = setup()
    const body = { ids: ['b', 'a'] }

    const pending = await auditor.begin(write('PUT', 'admin/combos/order', {}, body))
    await auditor.complete(pending, undefined)

    expect(auditLog.reads).toEqual([])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'combo.reorder',
        entityType: 'combo',
        entityId: null,
        changes: { input: body },
      },
    ])
  })

  it('el cambio de contraseña queda anotado sin contenido: changes vacío y nada del cuerpo', async () => {
    const { auditLog, auditor } = setup()
    const body = { currentPassword: 'vieja-123456', newPassword: 'nueva-123456', confirmation: 'x' }

    const pending = await auditor.begin(write('POST', 'admin/auth/password', {}, body))
    await auditor.complete(pending, undefined)

    expect(auditLog.reads).toEqual([])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'admin_user.password',
        entityType: 'admin_user',
        entityId: ADMIN,
        changes: {},
      },
    ])
    expect(JSON.stringify(auditLog.entries)).not.toContain('123456')
  })

  it('un cambio de estado de un pedido guarda el estado y ninguna columna del cliente', async () => {
    const { auditLog, auditor } = setup()
    const order = {
      number: 'GLP-10001',
      status: 'paid',
      contact_email: 'lucia@ejemplo.com',
      contact_first_name: 'Lucía',
      contact_last_name: 'Pérez',
      contact_phone: '+54 11 5555-5555',
      shipping_address: { street: 'Av. Corrientes', number: '1234' },
      updated_at: '2026-11-01T10:00:00.000+00:00',
    }
    auditLog.set('orders', 'GLP-10001', order)
    const body = { status: 'preparing' }

    const pending = await auditor.begin(
      write('POST', 'admin/orders/:number/status', { number: 'GLP-10001' }, body),
    )
    auditLog.set('orders', 'GLP-10001', { ...order, status: 'preparing', updated_at: 'después' })
    await auditor.complete(pending, {
      number: 'GLP-10001',
      customer: { email: order.contact_email },
    })

    expect(auditLog.reads).toEqual(['orders.number=GLP-10001', 'orders.number=GLP-10001'])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'order.status',
        entityType: 'order',
        entityId: 'GLP-10001',
        changes: { input: body, before: { status: 'paid' }, after: { status: 'preparing' } },
      },
    ])
    const stored = JSON.stringify(auditLog.entries)
    for (const personal of ['lucia@ejemplo.com', 'Lucía', 'Pérez', '5555', 'Corrientes']) {
      expect(stored).not.toContain(personal)
    }
  })

  it('un documento legal se busca por su clave de contenido', async () => {
    const { auditLog, auditor } = setup()
    auditLog.set('content_blocks', 'legal-terms', { key: 'legal-terms', data: { title: 'A' } })

    const pending = await auditor.begin(
      write('PUT', 'admin/content/legal/:document', { document: 'terms' }, { title: 'B' }),
    )
    auditLog.set('content_blocks', 'legal-terms', { key: 'legal-terms', data: { title: 'B' } })
    await auditor.complete(pending, { title: 'B' })

    expect(auditLog.entries[0]).toMatchObject({
      action: 'content.update',
      entityId: 'legal-terms',
      changes: { before: { data: { title: 'A' } }, after: { data: { title: 'B' } } },
    })
  })

  it('una ruta sin descriptor: el primer parámetro como id y solo el input', async () => {
    const { auditLog, auditor } = setup()

    const pending = await auditor.begin(
      write('POST', 'admin/coupons/:couponId/disable', { couponId: 'cup-1' }, { reason: 'x' }),
    )
    await auditor.complete(pending, { id: 'otra-cosa' })

    expect(auditLog.reads).toEqual([])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN,
        action: 'coupons.disable',
        entityType: 'coupons',
        entityId: 'cup-1',
        changes: { input: { reason: 'x' } },
      },
    ])
  })

  it('un cuerpo de más de 32 kB deja solo su tamaño', async () => {
    const { auditLog, auditor } = setup()
    const body = { ids: ['a'.repeat(MAX_INPUT_BYTES)] }

    const pending = await auditor.begin(write('PUT', 'admin/categories/order', {}, body))
    await auditor.complete(pending, undefined)

    expect(auditLog.entries[0]?.changes).toEqual({
      input: { truncated: true, bytes: Buffer.byteLength(JSON.stringify(body), 'utf8') },
    })
  })

  it('si la fila no aparece ni antes ni después (id con mala forma), no hay foto', async () => {
    const { auditLog, log, auditor } = setup()

    const pending = await auditor.begin(
      write('PATCH', 'admin/reviews/:id', { id: 'no-es-uuid' }, { status: 'approved' }),
    )
    await auditor.complete(pending, { id: 'no-es-uuid' })

    expect(auditLog.entries[0]).toMatchObject({
      action: 'review.update',
      entityId: 'no-es-uuid',
      changes: { input: { status: 'approved' } },
    })
    expect(Object.keys(auditLog.entries[0]?.changes ?? {})).toEqual(['input'])
    expect(log.errors).toEqual([])
  })

  it('un alta cuya respuesta no trae id queda sin entidad y sin foto', async () => {
    const { auditLog, auditor } = setup()

    const pending = await auditor.begin(write('POST', 'admin/products', {}, { name: 'Mate' }))
    await auditor.complete(pending, undefined)

    expect(auditLog.reads).toEqual([])
    expect(auditLog.entries[0]).toMatchObject({
      action: 'product.create',
      entityId: null,
      changes: { input: { name: 'Mate' } },
    })
  })

  describe('si la auditoría falla, la escritura del admin sigue adelante', () => {
    const body = { name: 'Secreto del cuerpo' }

    function categoryUpdate(): AdminWrite {
      return write('PATCH', 'admin/categories/:id', { id: CATEGORY_ID }, body)
    }

    /** El log nombra la acción y la entidad, y nunca el cuerpo ni el mensaje del error. */
    function expectSafeError(log: FakeLog, start: string): void {
      expect(log.errors).toHaveLength(1)
      const [message = ''] = log.errors
      expect(message.startsWith(start)).toBe(true)
      expect(message).toContain('category.update')
      expect(message).toContain(`category ${CATEGORY_ID}`)
      expect(message).toContain('DatabaseDown P1001')
      expect(message).not.toContain('Secreto')
      expect(message).not.toContain('No responde')
    }

    it('falla la lectura de antes: begin no lanza, la fila se guarda sin foto y queda un error', async () => {
      const { auditLog, log, auditor } = setup()
      auditLog.set('categories', CATEGORY_ID, CATEGORY)
      auditLog.failingReads = new Set([1])

      const pending = await auditor.begin(categoryUpdate())
      await auditor.complete(pending, { id: CATEGORY_ID })

      expect(auditLog.reads).toHaveLength(1)
      expect(auditLog.entries).toEqual([
        {
          actorUserId: ADMIN,
          action: 'category.update',
          entityType: 'category',
          entityId: CATEGORY_ID,
          changes: { input: body },
        },
      ])
      expectSafeError(log, 'No se pudo leer la fila')
    })

    it('falla la lectura de después: la fila se guarda sin foto y queda un error', async () => {
      const { auditLog, log, auditor } = setup()
      auditLog.set('categories', CATEGORY_ID, CATEGORY)
      auditLog.failingReads = new Set([2])

      const pending = await auditor.begin(categoryUpdate())
      await auditor.complete(pending, { id: CATEGORY_ID })

      expect(auditLog.entries.map((entry) => entry.changes)).toEqual([{ input: body }])
      expectSafeError(log, 'No se pudo leer la fila')
    })

    it('falla el guardado: complete no lanza, no queda fila y queda un error', async () => {
      const { auditLog, log, auditor } = setup()
      auditLog.set('categories', CATEGORY_ID, CATEGORY)
      auditLog.failAppend = true

      const pending = await auditor.begin(categoryUpdate())
      await expect(auditor.complete(pending, { id: CATEGORY_ID })).resolves.toBeUndefined()

      expect(auditLog.entries).toEqual([])
      expectSafeError(log, 'No se pudo guardar la auditoría')
    })

    it.each([
      ['un Error sin código', new Error('Secreto del cuerpo'), 'Error'],
      ['un texto', 'Secreto del cuerpo', 'string'],
      ['un objeto cualquiera', { code: 'Secreto del cuerpo' }, 'object'],
    ])('%s queda en el log solo con su nombre, sin su contenido', async (_title, thrown, name) => {
      const log = new FakeLog()
      const auditor = new AdminWriteAuditor(
        {
          readRow: () => Promise.resolve(null),
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- el caso es justamente un rechazo que no es un Error
          append: () => Promise.reject(thrown),
        },
        log,
      )

      const pending = await auditor.begin(write('PUT', 'admin/combos/order', {}, body))
      await expect(auditor.complete(pending, undefined)).resolves.toBeUndefined()

      expect(log.errors).toEqual([
        `No se pudo guardar la auditoría de combo.reorder (combo): ${name}`,
      ])
    })
  })
})
