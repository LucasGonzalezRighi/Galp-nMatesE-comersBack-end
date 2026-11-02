import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import {
  createStoreSettings,
  type Seller,
  type StoreSettings,
} from '../domain/store-settings.entity'
import type { SettingsRepository } from '../application/ports/settings.repository.port'

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

/** Lectura de `settings` (fila única) y `shipping_options` con Prisma (Postgres). */
@Injectable()
export class PrismaSettingsRepository implements SettingsRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc SettingsRepository.get} */
  async get(): Promise<StoreSettings> {
    const [settings, shippingOptions] = await Promise.all([
      this.prisma.settings.findUnique({ where: { id: 1 } }),
      this.prisma.shippingOption.findMany({
        orderBy: { method: 'asc' },
        select: { method: true, label: true, costArs: true, eta: true, enabled: true },
      }),
    ])
    if (settings === null) {
      throw new Error('Faltan los ajustes de la tienda: corré el seed (npm run db:seed).')
    }
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
}
