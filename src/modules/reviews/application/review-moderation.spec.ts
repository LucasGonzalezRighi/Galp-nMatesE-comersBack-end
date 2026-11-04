import { describe, expect, it } from 'vitest'

import type { Clock } from '../../../shared/domain/clock'
import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import {
  authorNameOrAnonymous,
  type ModeratedReview,
  moderationPatch,
  type NewReview,
  type ReviewPatch,
  type ReviewStatus,
  reviewStorefrontTags,
} from '../domain/review-moderation'
import { ReviewNotFoundError } from '../domain/reviews-errors'
import { ModerateReviewCommand } from './commands/moderate-review.command'
import { type ReviewInput, SubmitReviewCommand } from './commands/submit-review.command'
import type { ProductLookupPort } from './ports/product-lookup.port'
import type {
  ModeratedReviewSlice,
  ReviewModerationRepository,
} from './ports/review-moderation.repository.port'
import { ADMIN_REVIEWS_PAGE_SIZE, ListAdminReviewsQuery } from './queries/list-admin-reviews.query'

const NOW = new Date('2026-11-04T15:00:00.000Z')
const clock: Clock = { now: () => NOW }
const PRODUCT = { id: 'p-1', slug: 'mate-imperial-premium', name: 'Mate Imperial Premium' }

/** Producto publicado que conoce la búsqueda en memoria. */
const products: ProductLookupPort = {
  findPublishedIdBySlug: (slug) => Promise.resolve(slug === PRODUCT.slug ? PRODUCT.id : null),
}

/** Reseñas en memoria, con los avisos que se escribieron en "la misma transacción". */
class InMemoryReviews implements ReviewModerationRepository {
  readonly rows: ModeratedReview[] = []
  readonly events: NewDomainEvent[] = []

  submit(review: NewReview): Promise<void> {
    this.rows.push({
      ...review,
      id: `rev-${String(this.rows.length + 1)}`,
      createdAt: new Date(NOW.getTime() + this.rows.length * 1000),
      verifiedPurchase: false,
      status: 'pending',
      featured: false,
      moderatedAt: null,
      product: { slug: PRODUCT.slug, name: PRODUCT.name },
    })
    return Promise.resolve()
  }

  list(
    status: ReviewStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<ModeratedReviewSlice> {
    const matching = [...this.rows]
      .reverse()
      .filter((row) => status === undefined || row.status === status)
    const start = (page - 1) * pageSize
    return Promise.resolve({
      items: matching.slice(start, start + pageSize),
      total: matching.length,
    })
  }

  findById(id: string): Promise<ModeratedReview | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null)
  }

  update(id: string, patch: ReviewPatch, event: NewDomainEvent): Promise<ModeratedReview | null> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined) return Promise.resolve(null)
    Object.assign(row, patch)
    this.events.push(event)
    return Promise.resolve(row)
  }
}

const REVIEW: ReviewInput = {
  rating: 4.5,
  authorName: 'Lucas',
  text: 'Un mate hermoso, llegó rápido y bien embalado.',
  website: null,
}

describe('SubmitReviewCommand', () => {
  it('deja la reseña pending, sin compra verificada ni destacar', async () => {
    const reviews = new InMemoryReviews()

    await expect(
      new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, REVIEW),
    ).resolves.toEqual({ status: 'pending' })

    expect(reviews.rows).toEqual([
      expect.objectContaining({
        productId: PRODUCT.id,
        authorName: 'Lucas',
        rating: 4.5,
        status: 'pending',
        verifiedPurchase: false,
        featured: false,
      }),
    ])
  })

  it.each([null, '', '   '])('sin nombre (%j) la firma "Anónimo"', async (authorName) => {
    const reviews = new InMemoryReviews()

    await new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, {
      ...REVIEW,
      authorName,
    })

    expect(reviews.rows[0]?.authorName).toBe('Anónimo')
  })

  it('con el campo trampa lleno responde pending y no guarda nada', async () => {
    const reviews = new InMemoryReviews()

    await expect(
      new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, { ...REVIEW, website: ' ' }),
    ).resolves.toEqual({ status: 'pending' })
    expect(reviews.rows).toEqual([])
  })

  it('un producto que no existe da null (404) aunque el campo trampa venga lleno', async () => {
    const reviews = new InMemoryReviews()
    const command = new SubmitReviewCommand(products, reviews)

    await expect(command.execute('no-existe', REVIEW)).resolves.toBeNull()
    await expect(command.execute('no-existe', { ...REVIEW, website: 'spam' })).resolves.toBeNull()
  })

  it('una puntuación inválida no se guarda', async () => {
    const reviews = new InMemoryReviews()

    await expect(
      new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, { ...REVIEW, rating: 4.3 }),
    ).rejects.toThrow(RangeError)
  })
})

describe('moderación', () => {
  async function withPending(): Promise<InMemoryReviews> {
    const reviews = new InMemoryReviews()
    await new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, REVIEW)
    await new SubmitReviewCommand(products, reviews).execute(PRODUCT.slug, {
      ...REVIEW,
      authorName: null,
    })
    return reviews
  }

  const TAGS = [
    'reviews:featured',
    'reviews:mate-imperial-premium',
    'product:mate-imperial-premium',
    'products',
  ]

  it('aprobar pone moderatedAt y avisa a la tienda con las 4 etiquetas', async () => {
    const reviews = await withPending()

    const review = await new ModerateReviewCommand(reviews, clock).execute('rev-1', {
      status: 'approved',
      featured: true,
    })

    expect(review).toMatchObject({ id: 'rev-1', status: 'approved', featured: true })
    expect(review.product).toEqual({ slug: PRODUCT.slug, name: PRODUCT.name })
    expect(reviews.rows[0]?.moderatedAt).toEqual(NOW)
    expect(reviews.events).toEqual([
      {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'review.moderated',
        payload: { reason: 'review.moderated', tags: TAGS },
      },
    ])
  })

  it('solo destacar no pone moderatedAt pero igual avisa', async () => {
    const reviews = await withPending()

    await new ModerateReviewCommand(reviews, clock).execute('rev-2', { featured: true })

    expect(reviews.rows[1]).toMatchObject({ status: 'pending', featured: true, moderatedAt: null })
    expect(reviews.events.map((event) => event.payload)).toEqual([
      { reason: 'review.moderated', tags: TAGS },
    ])
  })

  it('el mismo estado que ya tenía no cuenta como moderación', () => {
    expect(moderationPatch({ status: 'approved' }, { status: 'approved' }, NOW)).toEqual({
      status: 'approved',
    })
    expect(moderationPatch({ status: 'pending' }, { status: 'hidden' }, NOW)).toEqual({
      status: 'hidden',
      moderatedAt: NOW,
    })
    expect(() => moderationPatch({ status: 'pending' }, {}, NOW)).toThrow(TypeError)
  })

  it('una reseña que no existe da ReviewNotFoundError (404) y no avisa', async () => {
    const reviews = await withPending()

    const error = await new ModerateReviewCommand(reviews, clock)
      .execute('no-es-un-uuid', { status: 'approved' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReviewNotFoundError)
    expect(error).toMatchObject({ status: 404, detail: 'No existe esa reseña.' })
    expect(reviews.events).toEqual([])
  })

  it('el listado va de la más nueva a la más vieja, de a 20, filtrado por estado', async () => {
    const reviews = await withPending()
    await new ModerateReviewCommand(reviews, clock).execute('rev-1', { status: 'hidden' })
    const query = new ListAdminReviewsQuery(reviews)

    const all = await query.execute(undefined, 1)
    expect(all.pageSize).toBe(ADMIN_REVIEWS_PAGE_SIZE)
    expect(all.items.map((item) => [item.id, item.status, item.authorName])).toEqual([
      ['rev-2', 'pending', 'Anónimo'],
      ['rev-1', 'hidden', 'Lucas'],
    ])
    expect((await query.execute('hidden', 1)).total).toBe(1)
    await expect(query.execute(undefined, 3)).resolves.toMatchObject({ items: [], total: 2 })
    await expect(query.execute(undefined, 0)).rejects.toThrow(RangeError)
  })
})

describe('reglas de la reseña', () => {
  it('authorNameOrAnonymous recorta o firma Anónimo', () => {
    expect(authorNameOrAnonymous('  Paula N. ')).toBe('Paula N.')
    expect(authorNameOrAnonymous(null)).toBe('Anónimo')
  })

  it('reviewStorefrontTags rechaza un slug vacío', () => {
    expect(() => reviewStorefrontTags(' ')).toThrow(TypeError)
  })
})
