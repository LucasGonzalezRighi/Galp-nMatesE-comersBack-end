// Formas de lectura de los ajustes: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

import type { Seller, ShippingOption } from '../domain/store-settings.entity'

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
}
