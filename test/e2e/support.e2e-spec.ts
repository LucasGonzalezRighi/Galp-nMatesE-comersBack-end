import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type { ContactMessagePage } from '../../src/modules/support/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, firstError, type HttpMethod, newJar } from '../support/http'

/** Fila de `contact_messages` con el motivo como texto de Postgres (el `@map` del enum). */
interface MessageRow {
  id: string
  kind: string
  email: string
  reason: string | null
  message: string | null
  code: string | null
  order_number: string | null
  read_at: Date | null
}

const CONTACT = {
  name: 'Lucía Gómez',
  email: '  Lucia.Gomez@Example.COM ',
  orderNumber: ' glp-12345 ',
  reason: 'Envío',
  message: 'Pedí un mate hace una semana y todavía no tengo novedades del envío.',
  website: null,
}

const WITHDRAWAL = {
  name: 'Lucía Gómez',
  email: 'lucia@example.com',
  orderNumber: null,
  comment: '  ',
  website: '',
}

describe('contacto, arrepentimiento y bandeja del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
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
    await seed(app.get(PrismaService))
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
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

  /** Pedido de la tienda, sin sesión. */
  function store(method: HttpMethod, path: string, body: unknown) {
    return call(server(), newJar(), method, path, { body })
  }

  /** La bandeja como la guarda Postgres, de la más vieja a la más nueva. */
  function rows(): Promise<MessageRow[]> {
    return prisma().$queryRaw<MessageRow[]>`
      SELECT id, kind::text AS kind, email::text AS email, reason::text AS reason, message, code,
             order_number, read_at
      FROM contact_messages ORDER BY created_at, id`
  }

  it('POST /contact → 202 sin cuerpo y la fila con el motivo "Envío", el email en minúsculas y el pedido en mayúsculas', async () => {
    const response = await store('post', '/contact', CONTACT)

    expect(response.status).toBe(202)
    expect(response.text).toBe('')
    expect(await rows()).toEqual([
      expect.objectContaining({
        kind: 'contact',
        email: 'lucia.gomez@example.com',
        reason: 'Envío',
        message: CONTACT.message,
        code: null,
        order_number: 'GLP-12345',
        read_at: null,
      }),
    ])
  })

  it('POST /contact con el campo trampa lleno → 202 sin guardar; con otro campo inválido → 422', async () => {
    const before = (await rows()).length

    const trapped = await store('post', '/contact', { ...CONTACT, website: ' ' })
    const invalid = await store('post', '/contact', {
      ...CONTACT,
      reason: 'Queja',
      website: 'https://spam.example',
    })

    expect(trapped.status).toBe(202)
    expect(invalid.status).toBe(422)
    expect(firstError(invalid)).toMatchObject({ field: 'reason', message: 'Elegí un motivo' })
    expect(await rows()).toHaveLength(before)
  })

  it('POST /withdrawals → 201 ARR-000001, después ARR-000002; con trampa, un código y sin fila', async () => {
    const first = await store('post', '/withdrawals', WITHDRAWAL)
    const second = await store('post', '/withdrawals', {
      ...WITHDRAWAL,
      orderNumber: 'GLP-10001',
      comment: 'Me arrepentí de la compra.',
    })
    const before = (await rows()).length
    const trapped = await store('post', '/withdrawals', { ...WITHDRAWAL, website: 'spam' })

    expect(first.status).toBe(201)
    expect(first.body).toEqual({ code: 'ARR-000001' })
    expect(second.status).toBe(201)
    expect(second.body).toEqual({ code: 'ARR-000002' })
    expect(trapped.status).toBe(201)
    expect(trapped.body).toEqual({ code: 'ARR-000003' })
    const saved = await rows()
    expect(saved).toHaveLength(before)
    expect(saved.filter((row) => row.kind === 'withdrawal')).toEqual([
      expect.objectContaining({ code: 'ARR-000001', reason: null, message: null }),
      expect.objectContaining({
        code: 'ARR-000002',
        message: 'Me arrepentí de la compra.',
        order_number: 'GLP-10001',
      }),
    ])
  })

  it('POST /withdrawals sin los campos nullable → 422 "Requerido" (el contrato los pide)', async () => {
    const response = await store('post', '/withdrawals', {
      name: 'Lucía Gómez',
      email: 'lucia@example.com',
    })

    expect(response.status).toBe(422)
    const fields = (response.body as { errors: { field: string; message: string }[] }).errors
    expect(fields.find((error) => error.field === 'orderNumber')?.message).toBe('Requerido')
    expect(fields.find((error) => error.field === 'website')?.message).toBe('Requerido')
  })

  it('GET /admin/messages lista del más nuevo al más viejo y filtra por tipo y leído', async () => {
    const all = await http('get', '/admin/messages')
    const contacts = await http('get', '/admin/messages?kind=contact&read=false')
    const anonymous = await call(server(), newJar(), 'get', '/admin/messages')

    expect(all.status).toBe(200)
    const page = all.body as ContactMessagePage
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3 })
    expect(page.items.map((item) => [item.kind, item.code, item.read])).toEqual([
      ['withdrawal', 'ARR-000002', false],
      ['withdrawal', 'ARR-000001', false],
      ['contact', null, false],
    ])
    expect(page.items[2]).toMatchObject({
      name: 'Lucía Gómez',
      email: 'lucia.gomez@example.com',
      orderNumber: 'GLP-12345',
      reason: 'Envío',
    })
    expect((contacts.body as ContactMessagePage).items.map((item) => item.kind)).toEqual([
      'contact',
    ])
    expect(anonymous.status).toBe(401)
  })

  it.each([
    ['read=quizas', 'read', 'El valor de read tiene que ser true o false.'],
    ['kind=x', 'kind', 'El tipo de mensaje tiene que ser contact, withdrawal.'],
    ['page=0', 'page', 'La página tiene que ser mayor o igual a 1.'],
    ['pageSize=5', 'pageSize', 'Este campo no está permitido.'],
  ])('GET /admin/messages?%s → 422 en %s', async (query, field, message) => {
    const response = await http('get', `/admin/messages?${query}`)

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject({ field, message })
  })

  it('PATCH { read: true } dos veces conserva el read_at del primero y { read: false } lo borra', async () => {
    const [contact] = await rows()
    const id = contact?.id ?? ''

    const first = await http('patch', `/admin/messages/${id}`, { body: { read: true } })
    const readAt = (await rows()).find((row) => row.id === id)?.read_at
    const second = await http('patch', `/admin/messages/${id}`, { body: { read: true } })
    const unread = await call(server(), admin, 'get', '/admin/messages?read=true')

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id, kind: 'contact', read: true })
    expect(readAt).toBeInstanceOf(Date)
    expect(second.status).toBe(200)
    expect((await rows()).find((row) => row.id === id)?.read_at).toEqual(readAt)
    expect((unread.body as ContactMessagePage).items.map((item) => item.id)).toEqual([id])

    const cleared = await http('patch', `/admin/messages/${id}`, { body: { read: false } })

    expect(cleared.status).toBe(200)
    expect(cleared.body).toMatchObject({ id, read: false })
    expect((await rows()).find((row) => row.id === id)?.read_at).toBeNull()
  })

  it('PATCH: id que no existe → 404, sin CSRF → 403, sin read o con "true" → 422', async () => {
    const [contact] = await rows()
    const id = contact?.id ?? ''

    const missing = await http('patch', '/admin/messages/msg-0001', { body: { read: true } })
    const noCsrf = await http('patch', `/admin/messages/${id}`, {
      body: { read: true },
      csrf: false,
    })
    const empty = await http('patch', `/admin/messages/${id}`, { body: {} })
    const text = await http('patch', `/admin/messages/${id}`, { body: { read: 'true' } })

    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ type: 'not_found', detail: 'No existe ese mensaje.' })
    expect(noCsrf.status).toBe(403)
    expect(empty.status).toBe(422)
    expect(firstError(empty)).toMatchObject({ field: 'read' })
    expect(text.status).toBe(422)
    expect(firstError(text)).toMatchObject({
      field: 'read',
      message: 'El valor de read tiene que ser true o false.',
    })
  })
})
