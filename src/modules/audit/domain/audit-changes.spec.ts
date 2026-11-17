import { describe, expect, it } from 'vitest'

import { auditInput, buildChanges, diffSnapshot, MAX_INPUT_BYTES } from './audit-changes'

describe('auditInput', () => {
  it('guarda el cuerpo como JSON, en una copia', () => {
    const body = { name: 'Imperiales', tags: ['a', 'b'], image: null, nested: { n: 1 } }

    const input = auditInput(body)

    expect(input).toEqual(body)
    expect(input).not.toBe(body)
  })

  it('un cuerpo vacío que mandó el dashboard se guarda tal cual', () => {
    expect(auditInput({})).toEqual({})
    expect(auditInput([])).toEqual([])
  })

  it('sin cuerpo no hay nada que guardar', () => {
    expect(auditInput(undefined)).toBeUndefined()
  })

  it('lo que no se puede pasar a JSON no se guarda', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(auditInput(circular)).toBeUndefined()
    expect(auditInput(() => 1)).toBeUndefined()
    expect(auditInput({ big: 10n })).toBeUndefined()
  })

  it('hasta 32 kB va entero; con un byte más, solo el tamaño', () => {
    const overhead = Buffer.byteLength(JSON.stringify({ text: '' }), 'utf8')
    const atLimit = { text: 'a'.repeat(MAX_INPUT_BYTES - overhead) }
    const overLimit = { text: `${atLimit.text}a` }

    expect(MAX_INPUT_BYTES).toBe(32_768)
    expect(auditInput(atLimit)).toEqual(atLimit)
    expect(auditInput(overLimit)).toEqual({ truncated: true, bytes: MAX_INPUT_BYTES + 1 })
  })

  it('el tamaño se mide en bytes de UTF-8, no en caracteres', () => {
    const body = { text: 'ñ'.repeat(20_000) }

    expect(auditInput(body)).toEqual({
      truncated: true,
      bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    })
    expect(auditInput({ text: 'n'.repeat(20_000) })).toEqual({ text: 'n'.repeat(20_000) })
  })
})

describe('diffSnapshot', () => {
  const category = {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    slug: 'imperiales',
    name: 'Imperiales',
    blurb: 'Los clásicos',
    image_id: null,
    position: 1,
    created_at: '2026-11-01T10:00:00.000+00:00',
    updated_at: '2026-11-01T10:00:00.000+00:00',
  }

  it('una edición guarda solo las columnas que cambiaron, con las mismas claves antes y después', () => {
    const after = {
      ...category,
      name: 'Imperiales premium',
      position: 2,
      updated_at: '2026-11-17T12:00:00.000+00:00',
    }

    expect(diffSnapshot(category, after, false)).toEqual({
      before: { name: 'Imperiales', position: 1 },
      after: { name: 'Imperiales premium', position: 2 },
    })
  })

  it('ignora updated_at aunque sea lo único que cambió', () => {
    const after = { ...category, updated_at: '2026-11-17T12:00:00.000+00:00' }

    expect(diffSnapshot(category, after, false)).toEqual({ before: {}, after: {} })
  })

  it('un cambio a null o desde null es un cambio', () => {
    const after = { ...category, image_id: 'img-1', blurb: null }

    expect(diffSnapshot(category, after, false)).toEqual({
      before: { image_id: null, blurb: 'Los clásicos' },
      after: { image_id: 'img-1', blurb: null },
    })
  })

  it('compara las columnas JSON por valor: el orden de las claves no importa, el de las listas sí', () => {
    const before = { data: { title: 'Hola', items: [1, 2], seo: { a: 1, b: 2 } }, leathers: ['a'] }
    const sameData = {
      data: { seo: { b: 2, a: 1 }, items: [1, 2], title: 'Hola' },
      leathers: ['a'],
    }
    const reordered = {
      data: { title: 'Hola', items: [2, 1], seo: { a: 1, b: 2 } },
      leathers: ['a'],
    }

    expect(diffSnapshot(before, sameData, false)).toEqual({ before: {}, after: {} })
    expect(diffSnapshot(before, reordered, false)).toEqual({
      before: { data: before.data },
      after: { data: reordered.data },
    })
  })

  it('una columna que está de un solo lado queda en los dos, con null donde falta', () => {
    expect(diffSnapshot({ a: 1 }, { a: 1, b: 2 }, false)).toEqual({
      before: { b: null },
      after: { b: 2 },
    })
  })

  it('un alta: before null y la fila entera en after', () => {
    expect(diffSnapshot(null, category, false)).toEqual({ before: null, after: category })
  })

  it('un borrado: la fila entera en before y after null', () => {
    expect(diffSnapshot(category, null, false)).toEqual({ before: category, after: null })
  })

  it('sin ninguna de las dos filas no hay foto', () => {
    expect(diffSnapshot(null, null, false)).toBeNull()
    expect(diffSnapshot(null, null, true)).toBeNull()
  })

  describe('filas con datos de clientes (pedidos, reseñas, mensajes)', () => {
    const order = {
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      number: 'GLP-10001',
      status: 'paid',
      payment_status: 'approved',
      contact_email: 'lucia@ejemplo.com',
      contact_first_name: 'Lucía',
      contact_last_name: 'Pérez',
      contact_phone: '+54 11 5555-5555',
      shipping_address: { street: 'Av. Corrientes', number: '1234', city: 'CABA' },
      total_ars: 45000,
      cancelled_at: null,
      updated_at: '2026-11-01T10:00:00.000+00:00',
    }

    it('un cambio de estado de un pedido guarda el estado y ninguna columna del cliente', () => {
      const after = { ...order, status: 'preparing', updated_at: '2026-11-17T12:00:00.000+00:00' }

      const diff = diffSnapshot(order, after, true)

      expect(diff).toEqual({ before: { status: 'paid' }, after: { status: 'preparing' } })
      const stored = JSON.stringify(diff)
      for (const personal of ['lucia@ejemplo.com', 'Lucía', 'Pérez', '5555', 'Corrientes']) {
        expect(stored).not.toContain(personal)
      }
      for (const column of ['contact_', 'shipping_address']) {
        expect(stored).not.toContain(column)
      }
    })

    it('nunca guarda la fila entera: si falta la de antes o la de después, no hay foto', () => {
      expect(diffSnapshot(null, order, true)).toBeNull()
      expect(diffSnapshot(order, null, true)).toBeNull()
    })
  })
})

describe('buildChanges', () => {
  it('lo que mandó el dashboard y la foto: { input, before, after }', () => {
    const snapshot = { before: { name: 'A' }, after: { name: 'B' } }

    expect(buildChanges({ name: 'B' }, snapshot)).toEqual({
      input: { name: 'B' },
      before: { name: 'A' },
      after: { name: 'B' },
    })
  })

  it('un alta y un borrado conservan el null de la fila que no existe', () => {
    expect(buildChanges({ name: 'B' }, { before: null, after: { id: '1' } })).toEqual({
      input: { name: 'B' },
      before: null,
      after: { id: '1' },
    })
    expect(buildChanges(undefined, { before: { id: '1' }, after: null })).toEqual({
      before: { id: '1' },
      after: null,
    })
  })

  it('las claves que no aplican no van', () => {
    expect(Object.keys(buildChanges({ ids: ['a'] }, null))).toEqual(['input'])
    expect(Object.keys(buildChanges(undefined, { before: {}, after: {} }))).toEqual([
      'before',
      'after',
    ])
    expect(buildChanges(undefined, null)).toEqual({})
  })
})
