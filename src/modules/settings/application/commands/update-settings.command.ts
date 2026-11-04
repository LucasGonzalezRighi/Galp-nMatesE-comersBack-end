import { storefrontStaleEvent } from '../../../../shared/domain/storefront-tags'
import {
  createStoreSettings,
  DEFAULT_SHIPPING_LABELS,
  roundVatRatePercent,
  SETTINGS_STOREFRONT_TAGS,
  SETTINGS_UPDATED_REASON,
  SHIPPING_METHODS,
} from '../../domain/store-settings.entity'
import type {
  SettingsChanges,
  SettingsRepository,
  ShippingOptionChanges,
} from '../ports/settings.repository.port'
import { type AdminSettings, toAdminSettings } from '../read-models'

/** Ajustes como los manda el dashboard (`AdminSettings`), sin el `label` de cada envío. */
export interface AdminSettingsInput extends Omit<AdminSettings, 'shippingOptions'> {
  /** Las tres opciones de envío, una por método, en cualquier orden. */
  shippingOptions: ShippingOptionChanges[]
}

/**
 * Ordena las opciones de envío como las muestra la tienda (`home`, `branch`, `pickup`).
 *
 * @param options - Opciones del cuerpo.
 * @returns Las tres opciones en orden, solo con método, costo, plazo y si está habilitada.
 * @throws {RangeError} En español, si no viene exactamente una por método.
 */
function orderedShippingOptions(
  options: readonly ShippingOptionChanges[],
): ShippingOptionChanges[] {
  return SHIPPING_METHODS.map((method) => {
    const matches = options.filter((option) => option.method === method)
    const [option] = matches
    if (
      option === undefined ||
      matches.length !== 1 ||
      options.length !== SHIPPING_METHODS.length
    ) {
      throw new RangeError('Tienen que venir las tres opciones de envío, una por método.')
    }
    return { method, costArs: option.costArs, eta: option.eta, enabled: option.enabled }
  })
}

/** Guardado de los ajustes desde el dashboard (`PUT /admin/settings`). */
export class UpdateSettingsCommand {
  /** @param settings - Ajustes guardados (la escritura borra su caché después del commit). */
  constructor(private readonly settings: Pick<SettingsRepository, 'save'>) {}

  /**
   * Reemplaza los ajustes con su aviso a la tienda (`storefront.stale`, `settings.updated`, con
   * `settings`, `products` y `combos`) en la misma transacción. Los envíos quedan en el orden
   * `home`, `branch`, `pickup` y conservan su nombre (el `label` del cuerpo se ignora); el IVA se
   * redondea a 2 decimales (Ruling B-79).
   *
   * @param input - Ajustes completos, ya validados y normalizados por el pipe.
   * @param adminUserId - Usuario admin que los guarda.
   * @returns Los ajustes guardados (`AdminSettings`).
   * @throws {RangeError} En español, si los envíos no son uno por método o un valor está fuera de
   *   rango.
   * @throws {TypeError} En español, si falta el usuario o el email de contacto.
   */
  async execute(input: AdminSettingsInput, adminUserId: string): Promise<AdminSettings> {
    if (adminUserId.trim() === '') {
      throw new TypeError('Falta el usuario admin que guarda los ajustes.')
    }
    const shippingOptions = orderedShippingOptions(input.shippingOptions)
    const { seller } = input
    const changes: SettingsChanges = {
      kitDiscountPercent: input.kitDiscountPercent,
      installmentsMax: input.installments.maxWithoutInterest,
      installmentsShowOnProduct: input.installments.showOnProduct,
      contactEmail: input.contactEmail,
      lowStockThreshold: input.lowStockThreshold,
      vatRatePercent: roundVatRatePercent(input.vatRatePercent),
      showNetPrice: input.priceDisplay.showNetPrice,
      seller: {
        legalName: seller.legalName,
        cuit: seller.cuit,
        taxCondition: seller.taxCondition,
        address: seller.address,
        phone: seller.phone,
        supportArea: seller.supportArea,
        supportHours: seller.supportHours,
        dataFiscalUrl: seller.dataFiscalUrl,
      },
      shippingOptions,
    }
    // Los mismos rangos que se revisan al leer: un valor imposible no llega a la base.
    createStoreSettings({
      ...changes,
      shippingOptions: shippingOptions.map((option) => ({
        ...option,
        label: DEFAULT_SHIPPING_LABELS[option.method],
      })),
    })
    const saved = await this.settings.save(changes, {
      updatedBy: adminUserId,
      event: storefrontStaleEvent(SETTINGS_UPDATED_REASON, SETTINGS_STOREFRONT_TAGS),
    })
    return toAdminSettings(saved)
  }
}
