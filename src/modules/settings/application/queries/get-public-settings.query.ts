import type { SettingsRepository } from '../ports/settings.repository.port'
import type { PublicSettings } from '../read-models'

/** Ajustes públicos de la tienda (`GET /settings/public`). */
export class GetPublicSettingsQuery {
  /** @param settings - Lectura de los ajustes. */
  constructor(private readonly settings: SettingsRepository) {}

  /**
   * Devuelve solo lo que la tienda puede mostrar.
   *
   * @returns Los ajustes públicos, sin la alícuota de IVA ni el umbral de stock bajo.
   */
  async execute(): Promise<PublicSettings> {
    const settings = await this.settings.get()
    return {
      kitDiscountPercent: settings.kitDiscountPercent,
      shippingOptions: settings.shippingOptions,
      installments: {
        maxWithoutInterest: settings.installmentsMax,
        showOnProduct: settings.installmentsShowOnProduct,
      },
      contactEmail: settings.contactEmail,
      priceDisplay: { showNetPrice: settings.showNetPrice },
      seller: settings.seller,
    }
  }
}
