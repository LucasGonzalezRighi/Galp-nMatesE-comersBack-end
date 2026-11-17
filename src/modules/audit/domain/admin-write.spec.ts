import { describe, expect, it } from 'vitest'

import {
  ADMIN_WRITE_DESCRIPTORS,
  ADMIN_WRITE_EXCLUSIONS,
  type AdminWriteTarget,
  entityIdOf,
  resolveAdminWrite,
} from './admin-write'

/** Lo que se espera de cada escritura actual del dashboard. */
interface ExpectedWrite {
  method: string
  path: string
  action: string
  entityType: string
  /** De dónde sale el id (`param:id`, `response`, `fixed:home`, `actor`, `none`). */
  id: string
  /** `tabla.columna` de la foto, o `null` si no se lee. */
  row: string | null
}

const CURRENT_WRITES: ExpectedWrite[] = [
  w('POST', 'admin/categories', 'category.create', 'category', 'response', 'categories.id'),
  w('PUT', 'admin/categories/order', 'category.reorder', 'category', 'none', null),
  w('PATCH', 'admin/categories/:id', 'category.update', 'category', 'param:id', 'categories.id'),
  w('DELETE', 'admin/categories/:id', 'category.delete', 'category', 'param:id', 'categories.id'),
  w('POST', 'admin/combos', 'combo.create', 'combo', 'response', 'combos.id'),
  w('PUT', 'admin/combos/order', 'combo.reorder', 'combo', 'none', null),
  w('PATCH', 'admin/combos/:id', 'combo.update', 'combo', 'param:id', 'combos.id'),
  w('DELETE', 'admin/combos/:id', 'combo.delete', 'combo', 'param:id', 'combos.id'),
  w('POST', 'admin/products', 'product.create', 'product', 'response', 'products.id'),
  w('PATCH', 'admin/products/:id', 'product.update', 'product', 'param:id', 'products.id'),
  w('POST', 'admin/products/:id/archive', 'product.archive', 'product', 'param:id', 'products.id'),
  w('PUT', 'admin/content/home', 'content.update', 'content', 'fixed:home', 'content_blocks.key'),
  w('PUT', 'admin/content/about', 'content.update', 'content', 'fixed:about', 'content_blocks.key'),
  w('PUT', 'admin/content/faq', 'content.update', 'content', 'fixed:faq', 'content_blocks.key'),
  w(
    'PUT',
    'admin/content/footer',
    'content.update',
    'content',
    'fixed:footer',
    'content_blocks.key',
  ),
  w(
    'PUT',
    'admin/content/product-tabs',
    'content.update',
    'content',
    'fixed:product-tabs',
    'content_blocks.key',
  ),
  w(
    'PUT',
    'admin/content/legal/:document',
    'content.update',
    'content',
    'param:document',
    'content_blocks.key',
  ),
  w(
    'POST',
    'admin/orders/:number/status',
    'order.status',
    'order',
    'param:number',
    'orders.number',
  ),
  w('PATCH', 'admin/reviews/:id', 'review.update', 'review', 'param:id', 'reviews.id'),
  w('PUT', 'admin/settings', 'settings.update', 'settings', 'fixed:1', 'settings.id'),
  w(
    'PATCH',
    'admin/messages/:id',
    'contact_message.update',
    'contact_message',
    'param:id',
    'contact_messages.id',
  ),
  w('POST', 'admin/auth/password', 'admin_user.password', 'admin_user', 'actor', null),
]

function w(
  method: string,
  path: string,
  action: string,
  entityType: string,
  id: string,
  row: string | null,
): ExpectedWrite {
  return { method, path, action, entityType, id, row }
}

/** El origen del id de un destino, con la forma corta de {@link ExpectedWrite.id}. */
function idSource(target: AdminWriteTarget): string {
  const source = target.entityId
  switch (source.from) {
    case 'param':
      return `param:${source.name}`
    case 'fixed':
      return `fixed:${source.value}`
    default:
      return source.from
  }
}

function resolved(method: string, path: string): AdminWriteTarget {
  const target = resolveAdminWrite(method, path)
  if (target === null) throw new Error(`${method} ${path} no se audita`)
  return target
}

describe('resolveAdminWrite: las escrituras actuales del dashboard', () => {
  it.each(CURRENT_WRITES)('$method $path → $action', (expected) => {
    const target = resolved(expected.method, expected.path)

    expect(target.action).toBe(expected.action)
    expect(target.entityType).toBe(expected.entityType)
    expect(idSource(target)).toBe(expected.id)
    expect(
      target.snapshot === null ? null : `${target.snapshot.table}.${target.snapshot.keyColumn}`,
    ).toBe(expected.row)
  })

  it('la tabla no tiene filas de más ni repetidas', () => {
    const keys = ADMIN_WRITE_DESCRIPTORS.map((row) => `${row.method} ${row.path}`)

    expect([...keys].sort()).toEqual(CURRENT_WRITES.map((e) => `${e.method} ${e.path}`).sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('las acciones son <entidad>.<verbo> en minúsculas y cada fila es una escritura de admin/', () => {
    for (const row of ADMIN_WRITE_DESCRIPTORS) {
      expect(row.target.action).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/)
      expect(row.target.action.startsWith(`${row.target.entityType}.`)).toBe(true)
      expect(row.path.startsWith('admin/')).toBe(true)
    }
  })

  it('los nombres de tabla y columna de las fotos son identificadores simples', () => {
    for (const { target } of ADMIN_WRITE_DESCRIPTORS) {
      if (target.snapshot === null) continue
      expect(target.snapshot.table).toMatch(/^[a-z_]+$/)
      expect(target.snapshot.keyColumn).toMatch(/^[a-z_]+$/)
    }
  })

  it('pedidos, reseñas y mensajes están marcados con datos de clientes; el resto no', () => {
    const personal = ADMIN_WRITE_DESCRIPTORS.filter(
      ({ target }) => target.snapshot?.personalData === true,
    ).map(({ target }) => target.snapshot?.table)

    expect([...new Set(personal)].sort()).toEqual(['contact_messages', 'orders', 'reviews'])
  })

  it('solo el cambio de contraseña descarta el cuerpo', () => {
    const withoutInput = ADMIN_WRITE_DESCRIPTORS.filter(({ target }) => !target.storesInput).map(
      ({ target }) => target.action,
    )

    expect(withoutInput).toEqual(['admin_user.password'])
  })

  it('reordenar guarda solo lo que mandó el dashboard: sin entidad y sin foto', () => {
    for (const path of ['admin/categories/order', 'admin/combos/order']) {
      const target = resolved('PUT', path)

      expect(target.entityId).toEqual({ from: 'none' })
      expect(target.snapshot).toBeNull()
      expect(target.storesInput).toBe(true)
    }
  })

  it('acepta el método en minúsculas y la ruta con barras de más', () => {
    expect(resolved('patch', '/admin/categories/:id/').action).toBe('category.update')
  })
})

describe('resolveAdminWrite: lo que no se audita', () => {
  it('la lista de exclusiones es login, logout y la firma de fotos', () => {
    expect(ADMIN_WRITE_EXCLUSIONS).toEqual([
      'POST admin/auth/login',
      'POST admin/auth/logout',
      'POST admin/media/signature',
    ])
  })

  it.each(['admin/auth/login', 'admin/auth/logout', 'admin/media/signature'])(
    'POST %s → null',
    (path) => {
      expect(resolveAdminWrite('POST', path)).toBeNull()
    },
  )

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s no es una escritura', (method) => {
    expect(resolveAdminWrite(method, 'admin/categories')).toBeNull()
    expect(resolveAdminWrite(method, 'admin/categories/:id')).toBeNull()
  })

  it.each(['orders', 'me/addresses/:id', 'administrators', 'auth/login', 'admin', ''])(
    'POST "%s" no está bajo admin/',
    (path) => {
      expect(resolveAdminWrite('POST', path)).toBeNull()
    },
  )
})

describe('resolveAdminWrite: una escritura de admin sin descriptor (ruta futura)', () => {
  it('POST a la colección → <segmento>.create, sin entidad ni foto', () => {
    expect(resolveAdminWrite('POST', 'admin/coupons')).toEqual({
      action: 'coupons.create',
      entityType: 'coupons',
      entityId: { from: 'none' },
      snapshot: null,
      storesInput: true,
    })
  })

  it('PATCH, PUT y DELETE sobre una entidad → update y delete con el primer parámetro', () => {
    const byId = { from: 'param', name: 'couponId' }

    expect(resolved('PATCH', 'admin/coupons/:couponId')).toMatchObject({
      action: 'coupons.update',
      entityId: byId,
    })
    expect(resolved('PUT', 'admin/coupons/:couponId')).toMatchObject({
      action: 'coupons.update',
      entityId: byId,
    })
    expect(resolved('DELETE', 'admin/coupons/:couponId')).toMatchObject({
      action: 'coupons.delete',
      entityId: byId,
    })
  })

  it('el último segmento fijo es el verbo; "order" es reorder', () => {
    expect(resolved('POST', 'admin/coupons/:id/disable').action).toBe('coupons.disable')
    expect(resolved('POST', 'admin/coupons/:id/send-again').action).toBe('coupons.send_again')
    expect(resolved('PUT', 'admin/coupons/order').action).toBe('coupons.reorder')
    expect(resolved('POST', 'admin/coupons/Import').action).toBe('coupons.import')
  })

  it('el tipo de entidad queda en minúsculas con guiones bajos y el id sale del primer parámetro', () => {
    const target = resolved('POST', 'admin/gift-cards/:cardId/codes/:codeId')

    expect(target.entityType).toBe('gift_cards')
    expect(target.action).toBe('gift_cards.create')
    expect(target.entityId).toEqual({ from: 'param', name: 'cardId' })
    expect(target.snapshot).toBeNull()
  })

  it('una ruta nueva de un recurso conocido también se audita, de forma genérica', () => {
    expect(resolved('POST', 'admin/products/:id/duplicate')).toMatchObject({
      action: 'products.duplicate',
      entityType: 'products',
      entityId: { from: 'param', name: 'id' },
      snapshot: null,
    })
  })
})

describe('entityIdOf', () => {
  const context = {
    params: { id: '0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B', number: 'GLP-10001', document: 'terms' },
    actorUserId: '0190a1b2-c3d4-7e5f-8a9b-000000000001',
  }

  it('de un parámetro de la ruta: un uuid va en minúsculas y lo demás, tal cual', () => {
    expect(entityIdOf({ from: 'param', name: 'id' }, context)).toBe(
      '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
    expect(entityIdOf({ from: 'param', name: 'number' }, context)).toBe('GLP-10001')
  })

  it('un documento legal es la clave del contenido: legal-<documento>', () => {
    const target = resolved('PUT', 'admin/content/legal/:document')

    expect(entityIdOf(target.entityId, context)).toBe('legal-terms')
  })

  it('un parámetro que falta o que no es texto no da id', () => {
    expect(entityIdOf({ from: 'param', name: 'slug' }, context)).toBeNull()
    expect(
      entityIdOf({ from: 'param', name: 'id' }, { ...context, params: { id: ['a', 'b'] } }),
    ).toBeNull()
    expect(entityIdOf({ from: 'param', name: 'id' }, { ...context, params: { id: '' } })).toBeNull()
  })

  it('fijo, del admin de la sesión o ninguno', () => {
    expect(entityIdOf({ from: 'fixed', value: 'home' }, context)).toBe('home')
    expect(entityIdOf({ from: 'actor' }, context)).toBe(context.actorUserId)
    expect(entityIdOf({ from: 'none' }, context)).toBeNull()
  })

  it('de la respuesta de un alta: su `id`; antes del handler todavía no se sabe', () => {
    const source = { from: 'response' } as const

    expect(entityIdOf(source, context)).toBeNull()
    expect(entityIdOf(source, { ...context, response: { id: 'ABC', name: 'x' } })).toBe('ABC')
    expect(
      entityIdOf(source, {
        ...context,
        response: { id: '0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B' },
      }),
    ).toBe('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')
  })

  it.each([undefined, null, 'texto', 7, [], {}, { id: 7 }, { id: '' }, { id: null }])(
    'una respuesta sin `id` de texto (%j) no da id',
    (response) => {
      expect(entityIdOf({ from: 'response' }, { ...context, response })).toBeNull()
    },
  )
})
