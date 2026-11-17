import { describe, expect, it } from 'vitest'

import { PURGE_TARGETS, purgeCutoffs, RETENTION } from './retention'

const NOW = new Date('2026-11-17T12:00:00.000Z')

describe('RETENTION', () => {
  it('tiene los plazos de LS-5 y del plan', () => {
    expect(RETENTION).toEqual({
      idempotencyKeysHours: 48,
      expiredPasswordResetTokensDays: 7,
      contactMessagesMonths: 24,
      processedWebhookEventsDays: 90,
      publishedOutboxEventsDays: 90,
      unapprovedReviewsMonths: 12,
      ordersYears: 10,
      withdrawalRequestsYears: 10,
    })
  })
})

describe('purgeCutoffs', () => {
  it('calcula el corte de cada tipo de dato desde ahora', () => {
    expect(purgeCutoffs(NOW)).toEqual({
      idempotencyKeys: new Date('2026-11-15T12:00:00.000Z'),
      passwordResetTokens: new Date('2026-11-10T12:00:00.000Z'),
      contactMessages: new Date('2024-11-17T12:00:00.000Z'),
      webhookEvents: new Date('2026-08-19T12:00:00.000Z'),
      outboxEvents: new Date('2026-08-19T12:00:00.000Z'),
      reviews: new Date('2025-11-17T12:00:00.000Z'),
    })
  })

  it('no purga pedidos ni solicitudes de arrepentimiento', () => {
    expect(PURGE_TARGETS).toEqual([
      'idempotencyKeys',
      'passwordResetTokens',
      'contactMessages',
      'webhookEvents',
      'outboxEvents',
      'reviews',
    ])
  })

  it('rechaza una fecha inválida', () => {
    expect(() => purgeCutoffs(new Date('no es fecha'))).toThrow('La fecha de la purga no es válida')
  })
})
