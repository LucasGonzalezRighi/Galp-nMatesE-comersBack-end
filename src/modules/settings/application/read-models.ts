// Formas de lectura de los ajustes: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

import type {
  ConsumerLinks,
  Seller,
  ShippingOption,
  StoreSettings,
} from '../domain/store-settings.entity'

/** Ajustes que la tienda puede mostrar (`PublicSettings`): nunca la alícuota ni el stock bajo. */
export interface PublicSettings {
  /** Descuento del kit, de 0 a 30 %. */
  kitDiscountPercent: number
  /** Las tres opciones de envío. */
  shippingOptions: ShippingOption[]
  /** Cuotas sin interés. */
  installments: {
    /** Máximo de cuotas sin interés (1 a 12). */
    maxWithoutInterest: number
    /** Si se muestran en la ficha. */
    showOnProduct: boolean
  }
  /** Email de contacto. */
  contactEmail: string
  /** Cómo se muestran los precios. */
  priceDisplay: {
    /** Si se muestra el precio sin impuestos nacionales. */
    showNetPrice: boolean
  }
  /** Datos del vendedor. */
  seller: Seller
  /** Enlaces a Defensa del Consumidor que el pie muestra siempre. */
  consumerLinks: ConsumerLinks
}

/** Ajustes del dashboard (`AdminSettings`): los públicos más el umbral de poco stock y el IVA. */
export interface AdminSettings extends PublicSettings {
  /** Unidades desde las que un producto cuenta como "con poco stock" (0 a 999). */
  lowStockThreshold: number
  /** Alícuota de IVA en porcentaje, de 0 a 100 (hasta 2 decimales). */
  vatRatePercent: number
}

/**
 * Arma los ajustes públicos (`PublicSettings`) de los completos.
 *
 * @param settings - Ajustes completos de la tienda.
 * @returns Solo lo que la tienda puede mostrar.
 */
export function toPublicSettings(settings: StoreSettings): PublicSettings {
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
    consumerLinks: { ...settings.consumerLinks },
  }
}

/**
 * Arma los ajustes del dashboard (`AdminSettings`) de los completos.
 *
 * @param settings - Ajustes completos de la tienda.
 * @returns Los públicos más `lowStockThreshold` y `vatRatePercent`.
 */
export function toAdminSettings(settings: StoreSettings): AdminSettings {
  return {
    ...toPublicSettings(settings),
    lowStockThreshold: settings.lowStockThreshold,
    vatRatePercent: settings.vatRatePercent,
  }
}
