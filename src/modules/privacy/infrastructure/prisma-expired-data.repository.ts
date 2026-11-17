import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ExpiredDataRepository } from '../application/ports/expired-data.repository.port'
import type { PurgeTarget } from '../domain/retention'

/**
 * Borra los datos vencidos con un `DELETE … WHERE ctid IN (SELECT … LIMIT n)` por tipo, así cada
 * lote es corto y no bloquea la tabla. Lecturas cruzadas solo acá (ADR 0001).
 */
@Injectable()
export class PrismaExpiredDataRepository implements ExpiredDataRepository {
  /** @param prisma - Cliente de Postgres. */
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** {@inheritDoc ExpiredDataRepository.deleteBatch} */
  deleteBatch(target: PurgeTarget, cutoff: Date, limit: number): Promise<number> {
    const db = this.prisma
    switch (target) {
      case 'idempotencyKeys':
        return db.$executeRaw`
          DELETE FROM idempotency_keys WHERE ctid IN (
            SELECT ctid FROM idempotency_keys WHERE created_at < ${cutoff} LIMIT ${limit})`
      case 'passwordResetTokens':
        return db.$executeRaw`
          DELETE FROM password_reset_tokens WHERE ctid IN (
            SELECT ctid FROM password_reset_tokens WHERE expires_at < ${cutoff} LIMIT ${limit})`
      case 'contactMessages':
        // Solo el formulario de contacto: las solicitudes de arrepentimiento se conservan 10 años.
        return db.$executeRaw`
          DELETE FROM contact_messages WHERE ctid IN (
            SELECT ctid FROM contact_messages
            WHERE kind = 'contact' AND created_at < ${cutoff} LIMIT ${limit})`
      case 'webhookEvents':
        return db.$executeRaw`
          DELETE FROM webhook_events WHERE ctid IN (
            SELECT ctid FROM webhook_events WHERE processed_at < ${cutoff} LIMIT ${limit})`
      case 'outboxEvents':
        return db.$executeRaw`
          DELETE FROM outbox_events WHERE ctid IN (
            SELECT ctid FROM outbox_events WHERE published_at < ${cutoff} LIMIT ${limit})`
      case 'reviews':
        // Pendientes u ocultas (rechazadas); las aprobadas se quedan.
        return db.$executeRaw`
          DELETE FROM reviews WHERE ctid IN (
            SELECT ctid FROM reviews
            WHERE status IN ('pending', 'hidden') AND created_at < ${cutoff} LIMIT ${limit})`
    }
  }
}
