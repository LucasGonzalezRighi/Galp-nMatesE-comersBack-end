import { Inject, Injectable } from '@nestjs/common'

import { GetStoreSettingsQuery } from '../../settings/application/queries/get-store-settings.query'
import type { PriceDisplay, PriceDisplayPort } from '../application/ports/price-display.port'

/** Ajustes de precios del catálogo, leídos del módulo `settings` (con su caché de 300 s). */
@Injectable()
export class SettingsPriceDisplayAdapter implements PriceDisplayPort {
  /** @param settings - Ajustes completos de la tienda. */
  constructor(@Inject(GetStoreSettingsQuery) private readonly settings: GetStoreSettingsQuery) {}

  /** {@inheritDoc PriceDisplayPort.get} */
  async get(): Promise<PriceDisplay> {
    const { showNetPrice, vatRatePercent } = await this.settings.execute()
    return { showNetPrice, vatRatePercent }
  }
}
