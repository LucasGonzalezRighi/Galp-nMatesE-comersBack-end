import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import {
  createStoreSettings,
  DEFAULT_SHIPPING_LABELS,
  type Seller,
  type StoreSettings,
} from '../domain/store-settings.entity'
import type {
  SettingsChanges,
  SettingsRepository,
  SettingsWrite,
} from '../application/ports/settings.repository.port'

/** Error de los ajustes que faltan en la base. */
const MISSING_SETTINGS = 'Faltan los ajustes de la tienda: corré el seed (npm run db:seed).'

/** Campos de {@link Seller}, en el orden del contrato. */
const SELLER_FIELDS = [
  'legalName',
  'cuit',
  'taxCondition',
  'address',
  'phone',
  'supportArea',
  'supportHours',
  'dataFiscalUrl',
] as const satisfies readonly (keyof Seller)[]

/**
 * Pasa la columna `seller` (JSON) a los datos del vendedor: cada campo que falta o no es texto
 * queda en `null`.
 */
function toSeller(json: Prisma.JsonValue): Seller {
  const source = json !== null && typeof json === 'object' && !Array.isArray(json) ? json : {}
  const seller = {} as Record<(typeof SELLER_FIELDS)[number], string | null>
  for (const field of SELLER_FIELDS) {
    const value = source[field]
    seller[field] = typeof value === 'string' ? value : null
  }
  return seller
}

/** Cliente con el que se lee: el de la app o el de una transacción. */
type SettingsClient = Pick<Prisma.TransactionClient, 'settings' | 'shippingOption'>

/** `settings` (fila única) y `shipping_options` con Prisma (Postgres), sin caché. */
@Injectable()
export class PrismaSettingsRepository implements SettingsRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (el aviso a la tienda va en la transacción de cada guardado).
   * @param clock - Reloj (`occurred_at` del evento).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** {@inheritDoc SettingsRepository.get} */
  get(): Promise<StoreSettings> {
    return read(this.prisma)
  }

  /** {@inheritDoc SettingsRepository.save} */
  save(changes: SettingsChanges, write: SettingsWrite): Promise<StoreSettings> {
    const { shippingOptions, seller, ...settings } = changes
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.settings.updateMany({
        where: { id: 1 },
        data: {
          ...settings,
          seller: { ...seller },
          version: { increment: 1 },
          updatedBy: write.updatedBy,
        },
      })
      if (count === 0) throw new Error(MISSING_SETTINGS)
      for (const { method, costArs, eta, enabled } of shippingOptions) {
        await tx.shippingOption.upsert({
          where: { method },
          update: { costArs, eta, enabled },
          create: { method, label: DEFAULT_SHIPPING_LABELS[method], costArs, eta, enabled },
          select: { method: true },
        })
      }
      await this.outbox.append(tx, createDomainEvent(write.event, this.clock.now()))
      return read(tx)
    })
  }
}

/**
 * Lee los ajustes con las opciones de envío en el orden del enum (`home`, `branch`, `pickup`).
 *
 * @param client - Cliente de la app o de la transacción en curso.
 * @returns Los ajustes validados.
 * @throws {Error} En español, si no está la fila (falta correr el seed).
 */
async function read(client: SettingsClient): Promise<StoreSettings> {
  const settings = await client.settings.findUnique({ where: { id: 1 } })
  if (settings === null) throw new Error(MISSING_SETTINGS)
  const shippingOptions = await client.shippingOption.findMany({
    orderBy: { method: 'asc' },
    select: { method: true, label: true, costArs: true, eta: true, enabled: true },
  })
  return createStoreSettings({
    kitDiscountPercent: settings.kitDiscountPercent,
    installmentsMax: settings.installmentsMax,
    installmentsShowOnProduct: settings.installmentsShowOnProduct,
    contactEmail: settings.contactEmail,
    lowStockThreshold: settings.lowStockThreshold,
    vatRatePercent: settings.vatRatePercent.toNumber(),
    showNetPrice: settings.showNetPrice,
    seller: toSeller(settings.seller),
    shippingOptions,
  })
}
