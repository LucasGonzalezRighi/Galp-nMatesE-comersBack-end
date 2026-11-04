import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type {
  AdminReview,
  AdminReviewPage,
  FeaturedReview,
} from '../../src/modules/reviews/application/read-models'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { type FakeStore, startFakeStore } from '../support/fake-store'
import { call, type CallOptions, firstError, type HttpMethod, newJar } from '../support/http'

/** Secreto de la tienda falsa (`STORE_REVALIDATE_SECRET`, mínimo 32 caracteres). */
const SECRET = 's'.repeat(32)

const SLUG = 'mate-imperial-premium'

/** Etiquetas que avisa una moderación de una reseña de {@link SLUG} (Ruling B-73). */
const MODERATION_TAGS = ['reviews:featured', `reviews:${SLUG}`, `product:${SLUG}`, 'products']

const REVIEW = {
  rating: 4.5,
  authorName: '  ',
  text: 'Muuu. Es el mate más lindo que tengo, llegó impecable.',
  website: null,
}

describe('reseñas nuevas y moderación del dashboard (HTTP + Postgres + Redis + tienda falsa)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let store: FakeStore | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    STORE_ORIGIN: process.env.STORE_ORIGIN,
    STORE_REVALIDATE_SECRET: process.env.STORE_REVALIDATE_SECRET,
  }
  const admin = newJar()

  beforeAll(async () => {
    store = await startFakeStore()
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    process.env.STORE_ORIGIN = store.origin
    process.env.STORE_REVALIDATE_SECRET = SECRET
    app = await createApp()
    await seed(app.get(PrismaService))
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    await store?.close()
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

  function fakeStore(): FakeStore {
    if (store === undefined) throw new Error('La tienda falsa no arrancó')
    return store
  }

  /** Pedido como el dashboard (sesión de admin y CSRF, salvo que se pida otra cosa). */
  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  /** Pedido de la tienda, sin sesión. */
  function visitor(method: HttpMethod, path: string, body?: unknown) {
    return call(server(), newJar(), method, path, body === undefined ? {} : { body })
  }

  /** Cantidad de avisos `storefront.stale` del outbox. */
  function staleCount(): Promise<number> {
    return prisma().outboxEvent.count({ where: { type: 'storefront.stale' } })
  }

  /** La reseña pendiente de {@link SLUG} que dejó el primer test. */
  async function pendingId(): Promise<string> {
    const pending = await prisma().review.findFirstOrThrow({
      where: { status: 'pending', product: { slug: SLUG } },
      select: { id: true },
    })
    return pending.id
  }

  async function ratingCount(): Promise<number> {
    const response = await visitor('get', `/products/${SLUG}`)
    expect(response.status).toBe(200)
    return (response.body as { rating: { count: number } }).rating.count
  }

  it('POST /products/{slug}/reviews → 202 pending; la fila queda "Anónimo", pendiente y sin compra verificada', async () => {
    const response = await visitor('post', `/products/${SLUG}/reviews`, REVIEW)

    expect(response.status).toBe(202)
    expect(response.body).toEqual({ status: 'pending' })
    const saved = await prisma().review.findFirstOrThrow({
      where: { status: 'pending', product: { slug: SLUG } },
    })
    expect(saved).toMatchObject({
      authorName: 'Anónimo',
      text: REVIEW.text,
      featured: false,
      verifiedPurchase: false,
      moderatedAt: null,
    })
    expect(saved.rating.toNumber()).toBe(4.5)
  })

  it('el envío público: 404 si el producto no existe (aunque haya trampa), trampa llena → 202 sin guardar', async () => {
    const before = await prisma().review.count()

    const missing = await visitor('post', '/products/no-existe/reviews', REVIEW)
    const trappedMissing = await visitor('post', '/products/no-existe/reviews', {
      ...REVIEW,
      website: 'spam',
    })
    const trapped = await visitor('post', `/products/${SLUG}/reviews`, { ...REVIEW, website: ' ' })

    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ detail: 'No existe un producto con ese slug.' })
    expect(trappedMissing.status).toBe(404)
    expect(trapped.status).toBe(202)
    expect(trapped.body).toEqual({ status: 'pending' })
    expect(await prisma().review.count()).toBe(before)
  })

  it('GET /admin/reviews lista en cualquier estado, de la más nueva a la más vieja, y filtra', async () => {
    const all = await http('get', '/admin/reviews')
    const pending = await http('get', '/admin/reviews?status=pending')
    const invalid = await http('get', '/admin/reviews?status=deleted')
    const anonymous = await call(server(), newJar(), 'get', '/admin/reviews')

    expect(all.status).toBe(200)
    const page = all.body as AdminReviewPage
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 19 })
    expect(page.items).toHaveLength(19)
    expect(page.items[0]).toMatchObject({
      authorName: 'Anónimo',
      status: 'pending',
      featured: false,
      product: { slug: SLUG, name: 'Mate Imperial Premium' },
    })
    expect((pending.body as AdminReviewPage).items.map((item) => item.status)).toEqual(['pending'])
    expect(invalid.status).toBe(422)
    expect(firstError(invalid)).toMatchObject({
      field: 'status',
      code: 'invalid_value',
      message: 'El estado tiene que ser pending, approved, hidden.',
    })
    expect(anonymous.status).toBe(401)
  })

  it('PATCH: {} → 422 de raíz; id que no es UUID → 404; sin CSRF → 403; ningún 4xx avisa', async () => {
    const id = await pendingId()
    const before = await staleCount()

    const empty = await http('patch', `/admin/reviews/${id}`, { body: {} })
    const unknownStatus = await http('patch', `/admin/reviews/${id}`, {
      body: { status: 'deleted' },
    })
    const missing = await http('patch', '/admin/reviews/rev-0001', {
      body: { status: 'approved' },
    })
    const noCsrf = await http('patch', `/admin/reviews/${id}`, {
      body: { status: 'approved' },
      csrf: false,
    })

    expect(empty.status).toBe(422)
    expect(empty.body).toMatchObject({
      errors: [{ field: '', code: 'empty_update', message: 'Mandá al menos un cambio' }],
    })
    expect(unknownStatus.status).toBe(422)
    expect(firstError(unknownStatus)).toMatchObject({ field: 'status', message: 'Elegí un estado' })
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ type: 'not_found', detail: 'No existe esa reseña.' })
    expect(noCsrf.status).toBe(403)
    expect(await staleCount()).toBe(before)
  })

  it('Review Focus 5: aprobar llega a la ficha cacheada (3 → 4) y la tienda recibe las 4 etiquetas', async () => {
    const id = await pendingId()
    expect(await ratingCount()).toBe(3)
    fakeStore().requests.length = 0

    const response = await http('patch', `/admin/reviews/${id}`, { body: { status: 'approved' } })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      id,
      status: 'approved',
      featured: false,
      authorName: 'Anónimo',
      rating: 4.5,
      verifiedPurchase: false,
      product: { slug: SLUG, name: 'Mate Imperial Premium' },
    } satisfies Partial<AdminReview>)
    expect(await ratingCount()).toBe(4)
    const row = await prisma().review.findUniqueOrThrow({ where: { id } })
    expect(row.moderatedAt).toBeInstanceOf(Date)

    await app?.get(OutboxRelay).runOnce()
    await vi.waitFor(
      () => {
        expect(fakeStore().tags()).toEqual([MODERATION_TAGS])
      },
      { timeout: 15_000, interval: 200 },
    )
    const stale = await prisma().outboxEvent.findMany({
      where: { type: 'storefront.stale', aggregateId: 'review.moderated' },
      select: { payload: true },
    })
    expect(stale).toEqual([{ payload: { reason: 'review.moderated', tags: MODERATION_TAGS } }])
  })

  it('destacar no cambia moderatedAt, avisa igual y la destacada aparece en /reviews/featured', async () => {
    const id = (await http('get', '/admin/reviews?status=approved')).body as AdminReviewPage
    const reviewId = id.items[0]?.id ?? ''
    const before = await prisma().review.findUniqueOrThrow({ where: { id: reviewId } })
    const staleBefore = await staleCount()

    const response = await http('patch', `/admin/reviews/${reviewId}`, {
      body: { featured: true },
    })
    const featured = await visitor('get', '/reviews/featured')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: reviewId, status: 'approved', featured: true })
    const after = await prisma().review.findUniqueOrThrow({ where: { id: reviewId } })
    expect(after.moderatedAt).toEqual(before.moderatedAt)
    expect(await staleCount()).toBe(staleBefore + 1)
    expect((featured.body as FeaturedReview[]).map((review) => review.id)).toContain(reviewId)
  })

  it('carrera entre admins: moderatedAt se decide con el estado bloqueado en la transacción, no con el leído antes', async () => {
    const text = 'Reseña para la carrera entre dos admins que la aprueban a la vez.'
    expect((await visitor('post', `/products/${SLUG}/reviews`, { ...REVIEW, text })).status).toBe(
      202,
    )
    const { id } = await prisma().review.findFirstOrThrow({ where: { text }, select: { id: true } })
    const earlier = new Date('2026-01-02T03:04:05.006Z')
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    // El otro admin aprueba primero y todavía no hizo commit: la fila queda bloqueada.
    let locked: () => void = () => undefined
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve
    })
    const otherAdmin = prisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE reviews SET status = 'approved', moderated_at = ${earlier} WHERE id = ${id}::uuid`
        locked()
        await held
      },
      { timeout: 30_000 },
    )
    await lockTaken
    // Este admin leyó la reseña pendiente (la aprobación del otro todavía no se ve) y la aprueba.
    const patch = http('patch', `/admin/reviews/${id}`, { body: { status: 'approved' } })
    await vi.waitFor(
      async () => {
        const [waiting] = await prisma().$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`
        expect(waiting?.n).toBeGreaterThan(0)
      },
      { timeout: 15_000, interval: 50 },
    )
    release()
    await otherAdmin
    const response = await patch

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id, status: 'approved' })
    const row = await prisma().review.findUniqueOrThrow({ where: { id } })
    expect(row.moderatedAt).toEqual(earlier)
  })
})
