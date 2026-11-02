/** Lo que el catálogo necesita de los ajustes para mostrar precios. */
export interface PriceDisplay {
  /** Si se muestra el precio sin impuestos nacionales. */
  showNetPrice: boolean
  /** Alícuota de IVA en porcentaje, de 0 a 100. */
  vatRatePercent: number
}

/** Lectura de los ajustes de precios (los implementa el módulo `settings`). */
export interface PriceDisplayPort {
  /** Devuelve cómo se muestran los precios. */
  get(): Promise<PriceDisplay>
}

/** Token de inyección del {@link PriceDisplayPort}. */
export const PRICE_DISPLAY_PORT = Symbol('PRICE_DISPLAY_PORT')
