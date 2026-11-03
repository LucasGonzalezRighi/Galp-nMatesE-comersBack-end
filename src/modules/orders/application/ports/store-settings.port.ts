import type { ShippingOption } from '../../../settings/domain/store-settings.entity'
import type { PricingSettings } from '../../domain/pricing'

/** Ajustes que usan la cotización y el pedido. */
export interface OrderSettings extends PricingSettings {
  /** Las tres opciones de envío, con costo, plazo y si están habilitadas. */
  shippingOptions: ShippingOption[]
}

/** Lo que `orders` necesita de los ajustes de la tienda. */
export interface StoreSettingsPort {
  /** @returns Descuento del kit, IVA, si se muestran los netos y las opciones de envío. */
  get(): Promise<OrderSettings>
}

/** Token de inyección del {@link StoreSettingsPort}. */
export const STORE_SETTINGS_PORT = Symbol('STORE_SETTINGS_PORT')
