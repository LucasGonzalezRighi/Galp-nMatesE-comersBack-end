import { Inject, Injectable } from '@nestjs/common'

import { GetStoreSettingsQuery } from '../../settings/application/queries/get-store-settings.query'
import type { OrderSettings, StoreSettingsPort } from '../application/ports/store-settings.port'

/** Ajustes que usan los pedidos, leídos del módulo `settings` (con su caché de 300 s). */
@Injectable()
export class SettingsStoreAdapter implements StoreSettingsPort {
  /** @param settings - Ajustes completos de la tienda. */
  constructor(@Inject(GetStoreSettingsQuery) private readonly settings: GetStoreSettingsQuery) {}

  /** {@inheritDoc StoreSettingsPort.get} */
  async get(): Promise<OrderSettings> {
    const { kitDiscountPercent, vatRatePercent, showNetPrice, shippingOptions } =
      await this.settings.execute()
    return {
      kitDiscountPercent,
      vatRatePercent,
      showNetPrice,
      shippingOptions: shippingOptions.map((option) => ({ ...option })),
    }
  }
}
