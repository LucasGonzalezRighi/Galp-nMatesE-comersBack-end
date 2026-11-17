import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type { Category } from '../../src/modules/catalog/application/read-models'
import type { LegalContent } from '../../src/modules/content/application/read-models'
import type { AdminSettings } from '../../src/modules/settings/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, newJar } from '../support/http'
import { HOME_ADDRESS, mateLine, ordersHttp } from '../support/orders-http'
import { simToken } from '../support/payments'

/** Fila de `audit_logs` como la devuelve una consulta SQL. */
interface AuditRow {
  id: string
  actor_user_id: string
  action: string
  entity_type: string
  entity_id: string | null
  changes: Record<string, unknown>
  created_at: Date
}

/** Datos de la compradora del pedido de prueba: ninguno puede quedar en la auditoría. */
const BUYER = {
  email: 'lucia.auditoria@ejemplo.com',
  firstName: 'Lucía',
  lastName: 'Pérez',
  phone: '1155551234',
}

const NEW_ADMIN_PASSWORD = 'galpon-nueva-2027'

/** Cuerpo de una línea nueva, como lo manda el dashboard (el nombre va sin recortar). */
const NEW_CATEGORY = {
  name: ' Calabazas ',
  slug: 'calabazas',
  group: 'mate',
  blurb: 'Las de siempre',
  image: null,
}

describe('audit_logs: escrituras del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let adminId = ''
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }
  const admin = newJar()

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    await seed(prisma())
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
    const user = await prisma().user.findUniqueOrThrow({
      where: { email: SEED_ADMIN.email },
      select: { id: true },
    })
    adminId = user.id
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  /** Pedido como el dashboard (sesión de admin y CSRF, salvo que se pida otra cosa). */
  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  /** Todas las filas de auditoría, de la más vieja a la más nueva (como se consultan por SQL). */
  function auditRows(): Promise<AuditRow[]> {
    return prisma().$queryRaw<AuditRow[]>`
      SELECT id, actor_user_id, action, entity_type, entity_id, changes, created_at
        FROM audit_logs ORDER BY created_at, id`
  }

  /** Corre unas escrituras y devuelve lo que respondieron y las filas de auditoría nuevas. */
  async function withAudit<T>(write: () => Promise<T>): Promise<{ result: T; rows: AuditRow[] }> {
    const before = (await auditRows()).length
    const result = await write()
    return { result, rows: (await auditRows()).slice(before) }
  }

  /** La única fila nueva de una escritura. */
  function only(rows: AuditRow[]): AuditRow {
    expect(rows).toHaveLength(1)
    const [row] = rows
    if (row === undefined) throw new Error('La escritura no dejó su fila de auditoría')
    return row
  }

  /** Fila de una línea como JSON, igual que la lee la auditoría. */
  async function categoryRow(id: string): Promise<Record<string, unknown>> {
    const rows = await prisma().$queryRaw<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(t) AS "row" FROM categories t WHERE t.id = ${id}::uuid`
    const [found] = rows
    if (found === undefined) throw new Error(`No hay línea con el id ${id}`)
    return found.row
  }

  it('una línea: el alta guarda la fila entera, la edición solo lo que cambió y el borrado la fila de antes', async () => {
    const created = await withAudit(() => http('post', '/admin/categories', { body: NEW_CATEGORY }))
    expect(created.result.status, JSON.stringify(created.result.body)).toBe(201)
    const category = created.result.body as Category
    const createdRow = await categoryRow(category.id)

    const edit = { ...NEW_CATEGORY, name: 'Calabazas forradas', blurb: '' }
    const updated = await withAudit(() =>
      http('patch', `/admin/categories/${category.id}`, { body: edit }),
    )
    expect(updated.result.status, JSON.stringify(updated.result.body)).toBe(200)
    const updatedRow = await categoryRow(category.id)

    const removed = await withAudit(() => http('delete', `/admin/categories/${category.id}`))
    expect(removed.result.status).toBe(204)

    const creation = only(created.rows)
    expect(creation).toMatchObject({
      actor_user_id: adminId,
      action: 'category.create',
      entity_type: 'category',
      entity_id: category.id,
      changes: { input: NEW_CATEGORY, before: null, after: createdRow },
    })
    expect(createdRow).toMatchObject({ id: category.id, name: 'Calabazas', slug: 'calabazas' })
    expect(Object.keys(createdRow).sort()).toEqual([
      'blurb',
      'created_at',
      'group',
      'id',
      'image_alt',
      'image_id',
      'name',
      'position',
      'slug',
      'updated_at',
    ])

    // Exactamente una fila, con las mismas claves antes y después y sin `updated_at`.
    const update = only(updated.rows)
    expect(update).toEqual({
      id: expect.any(String) as unknown,
      actor_user_id: adminId,
      action: 'category.update',
      entity_type: 'category',
      entity_id: category.id,
      changes: {
        input: edit,
        before: { name: 'Calabazas', blurb: 'Las de siempre' },
        after: { name: 'Calabazas forradas', blurb: '' },
      },
      created_at: expect.any(Date) as unknown,
    })
    expect(updatedRow.updated_at).not.toBe(createdRow.updated_at)

    const removal = only(removed.rows)
    expect(removal).toMatchObject({
      actor_user_id: adminId,
      action: 'category.delete',
      entity_type: 'category',
      entity_id: category.id,
    })
    expect(removal.changes).toEqual({ before: updatedRow, after: null })
  })

  it('un 422, un 409, un 404 (también con un id que no es UUID) y una escritura sin CSRF no dejan fila', async () => {
    const imperiales = await prisma().category.findUniqueOrThrow({
      where: { slug: 'imperiales' },
      select: { id: true },
    })

    const { result, rows } = await withAudit(async () => ({
      invalid: await http('patch', `/admin/categories/${imperiales.id}`, {
        body: { ...NEW_CATEGORY, name: '' },
      }),
      taken: await http('post', '/admin/categories', {
        body: { ...NEW_CATEGORY, slug: 'imperiales' },
      }),
      missing: await http('patch', `/admin/categories/${randomUUID()}`, { body: NEW_CATEGORY }),
      malformed: await http('delete', '/admin/categories/cat-imperiales'),
      noCsrf: await http('patch', `/admin/categories/${imperiales.id}`, {
        body: NEW_CATEGORY,
        csrf: false,
      }),
      noSession: await call(server(), newJar(), 'post', '/admin/categories', {
        body: NEW_CATEGORY,
      }),
    }))

    expect(result.invalid.status).toBe(422)
    expect(result.taken.status).toBe(409)
    expect(result.missing.status).toBe(404)
    expect(result.malformed.status).toBe(404)
    expect(result.noCsrf.status).toBe(403)
    expect(result.noSession.status).toBe(401)
    expect(rows).toEqual([])
  })

  it('un cambio de estado de un pedido guarda el estado y ninguna columna del cliente', async () => {
    const yerba = await prisma().product.findUniqueOrThrow({
      where: { slug: 'yerba-canarias-1-kg' },
      select: { id: true },
    })
    const body = await orderBody([mateLine(yerba.id)], BUYER.email)
    const { order, orderToken } = await createdOrder(newJar(), { ...body, customer: BUYER })
    const paid = await call(
      server(),
      newJar(),
      'post',
      `/orders/${order.number}/payments/mercadopago/card`,
      {
        headers: { 'X-Order-Token': orderToken, 'Idempotency-Key': randomUUID() },
        body: {
          token: simToken('APRO'),
          paymentMethodId: 'visa',
          issuerId: null,
          installments: 1,
          payer: { email: BUYER.email, identification: { type: 'DNI', number: '12.345.678' } },
        },
      },
    )
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)
    const change = {
      status: 'preparing',
      carrier: null,
      trackingNumber: null,
      note: 'Lo arma Bruno',
    }

    const { result, rows } = await withAudit(() =>
      http('post', `/admin/orders/${order.number}/status`, { body: change }),
    )

    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const row = only(rows)
    expect(row).toMatchObject({
      actor_user_id: adminId,
      action: 'order.status',
      entity_type: 'order',
      entity_id: order.number,
    })
    expect(row.changes).toEqual({
      input: change,
      before: { status: 'paid' },
      after: { status: 'preparing' },
    })
    // La fila del pedido sí tiene los datos de la compradora; la auditoría, ninguno.
    const saved = await prisma().order.findUniqueOrThrow({ where: { number: order.number } })
    expect(saved).toMatchObject({
      contactEmail: BUYER.email,
      contactFirstName: BUYER.firstName,
      contactLastName: BUYER.lastName,
      contactPhone: BUYER.phone,
    })
    const stored = JSON.stringify(await auditRows())
    for (const personal of [
      BUYER.email,
      BUYER.firstName,
      BUYER.lastName,
      BUYER.phone,
      HOME_ADDRESS.street,
      HOME_ADDRESS.postalCode,
    ]) {
      expect(stored).not.toContain(personal)
    }
    for (const column of ['contact_', 'shipping_address', 'customer_id', 'access_token_hash']) {
      expect(stored).not.toContain(column)
    }
  })

  it('una reseña y un mensaje: solo las columnas que cambiaron, sin el autor ni el texto', async () => {
    const review = await prisma().review.findFirstOrThrow({
      where: { status: 'approved', featured: false },
      select: { id: true, authorName: true, text: true },
    })
    const message = await prisma().contactMessage.create({
      data: {
        kind: 'contact',
        name: 'Bruno Gómez',
        email: 'bruno.auditoria@ejemplo.com',
        reason: 'envio',
        message: 'Todavía no me llegó el pedido de la semana pasada.',
      },
    })

    const { result, rows } = await withAudit(async () => ({
      review: await http('patch', `/admin/reviews/${review.id}`, { body: { status: 'hidden' } }),
      message: await http('patch', `/admin/messages/${message.id}`, { body: { read: true } }),
    }))

    expect(result.review.status, JSON.stringify(result.review.body)).toBe(200)
    expect(result.message.status, JSON.stringify(result.message.body)).toBe(200)
    expect(rows.map((row) => [row.action, row.entity_type, row.entity_id])).toEqual([
      ['review.update', 'review', review.id],
      ['contact_message.update', 'contact_message', message.id],
    ])
    const [moderation, read] = rows
    expect(moderation?.changes).toEqual({
      input: { status: 'hidden' },
      before: { status: 'approved', moderated_at: expect.any(String) as unknown },
      after: { status: 'hidden', moderated_at: expect.any(String) as unknown },
    })
    expect(read?.changes).toEqual({
      input: { read: true },
      before: { read_at: null },
      after: { read_at: expect.any(String) as unknown },
    })
    const stored = JSON.stringify(rows)
    for (const personal of [review.authorName, review.text, message.name, message.email]) {
      expect(stored).not.toContain(personal)
    }
  })

  it('ajustes, un documento legal, archivar un producto y reordenar: clave entera, de texto y sin entidad', async () => {
    const settings = (await http('get', '/admin/settings')).body as AdminSettings
    const terms = (await http('get', '/admin/content/legal/terms')).body as LegalContent
    const product = await prisma().product.findFirstOrThrow({
      where: { status: 'published', comboItems: { none: {} } },
      select: { id: true },
    })
    const lines = (await http('get', '/admin/categories')).body as Category[]
    const ids = lines.map((line) => line.id).reverse()
    const newSettings = { ...settings, kitDiscountPercent: settings.kitDiscountPercent + 1 }
    const newTerms = { ...terms, title: 'Términos de la auditoría' }

    const { result, rows } = await withAudit(async () => [
      await http('put', '/admin/settings', { body: newSettings }),
      await http('put', '/admin/content/legal/terms', { body: newTerms }),
      await http('post', `/admin/products/${product.id}/archive`),
      await http('put', '/admin/categories/order', { body: { ids } }),
    ])

    expect(result.map((response) => response.status)).toEqual([200, 200, 200, 204])
    expect(rows.map((row) => [row.action, row.entity_type, row.entity_id])).toEqual([
      ['settings.update', 'settings', '1'],
      ['content.update', 'content', 'legal-terms'],
      ['product.archive', 'product', product.id],
      ['category.reorder', 'category', null],
    ])
    expect(rows.every((row) => row.actor_user_id === adminId)).toBe(true)
    const [savedSettings, savedTerms, archived, reordered] = rows
    expect(savedSettings?.changes).toMatchObject({
      input: newSettings,
      before: { kit_discount_percent: settings.kitDiscountPercent },
      after: { kit_discount_percent: settings.kitDiscountPercent + 1, updated_by: adminId },
    })
    expect(savedTerms?.changes).toMatchObject({
      input: newTerms,
      before: { data: { title: terms.title } },
      after: { data: { title: 'Términos de la auditoría' }, updated_by: adminId },
    })
    // Archivar no manda cuerpo: no hay `input`.
    expect(archived?.changes).toEqual({
      before: { status: 'published' },
      after: { status: 'archived' },
    })
    expect(reordered?.changes).toEqual({ input: { ids } })
    for (const row of rows.slice(0, 3)) {
      const { before, after } = row.changes as { before: object; after: object }
      expect(Object.keys(before)).toEqual(Object.keys(after))
      expect(Object.keys(after)).not.toContain('updated_at')
    }
  })

  it('el inicio y el cierre de sesión y la firma de fotos no dejan fila', async () => {
    const other = newJar()

    const { result, rows } = await withAudit(async () => {
      const login = await call(server(), other, 'post', '/admin/auth/login', { body: SEED_ADMIN })
      other.csrf = (login.body as { csrfToken: string }).csrfToken
      const signature = await call(server(), other, 'post', '/admin/media/signature', {
        body: { purpose: 'product' },
      })
      const logout = await call(server(), other, 'post', '/admin/auth/logout')
      return { login, signature, logout }
    })

    expect(result.login.status).toBe(200)
    expect(result.signature.status, JSON.stringify(result.signature.body)).toBe(200)
    expect(result.logout.status).toBe(204)
    expect(rows).toEqual([])
  })

  it('el cambio de contraseña deja una fila sin contenido; con la actual mal, ninguna', async () => {
    const change = {
      currentPassword: SEED_ADMIN.password,
      newPassword: NEW_ADMIN_PASSWORD,
      confirmation: NEW_ADMIN_PASSWORD,
    }

    const wrong = await withAudit(() =>
      http('post', '/admin/auth/password', {
        body: { ...change, currentPassword: 'no-es-esta-2026' },
      }),
    )
    const done = await withAudit(() => http('post', '/admin/auth/password', { body: change }))

    expect(wrong.result.status).toBe(422)
    expect(wrong.rows).toEqual([])
    expect(done.result.status).toBe(204)
    expect(only(done.rows)).toEqual({
      id: expect.any(String) as unknown,
      actor_user_id: adminId,
      action: 'admin_user.password',
      entity_type: 'admin_user',
      entity_id: adminId,
      changes: {},
      created_at: expect.any(Date) as unknown,
    })
    const stored = JSON.stringify(await auditRows())
    expect(stored).not.toContain(SEED_ADMIN.password)
    expect(stored).not.toContain(NEW_ADMIN_PASSWORD)
    expect(stored).not.toContain('password_hash')
  })

  it('se consulta por SQL: el historial de una entidad, con el email del admin', async () => {
    const history = await prisma().$queryRaw<{ email: string; action: string }[]>`
      SELECT u.email, a.action
        FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
        WHERE a.entity_type = 'content' AND a.entity_id = 'legal-terms'
        ORDER BY a.created_at DESC`

    expect(history).toEqual([{ email: SEED_ADMIN.email, action: 'content.update' }])
  })
})
