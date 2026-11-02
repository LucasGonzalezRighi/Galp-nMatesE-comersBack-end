/** Métodos de envío del contrato, en el orden en que se muestran. */
export const SHIPPING_METHODS = ['home', 'branch', 'pickup'] as const

/** Método de envío. */
export type ShippingMethod = (typeof SHIPPING_METHODS)[number]

/** Opción de envío del checkout. */
export interface ShippingOption {
  /** Método. */
  method: ShippingMethod
  /** Nombre visible. */
  label: string
  /** Costo en pesos enteros. */
  costArs: number
  /** Plazo estimado. */
  eta: string
  /** Si se puede elegir. */
  enabled: boolean
}

/** Datos del vendedor, con `null` en lo que todavía no se cargó. */
export interface Seller {
  /** Razón social. */
  legalName: string | null
  /** CUIT (11 dígitos). */
  cuit: string | null
  /** Condición frente al IVA. */
  taxCondition: string | null
  /** Domicilio. */
  address: string | null
  /** Teléfono. */
  phone: string | null
  /** Área de atención. */
  supportArea: string | null
  /** Horario de atención. */
  supportHours: string | null
  /** URL del formulario "Data fiscal" de ARCA. */
  dataFiscalUrl: string | null
}

/** Ajustes completos de la tienda (incluye lo que no es público: IVA y stock bajo). */
export interface StoreSettings {
  /** Descuento del kit, de 0 a 30 %. */
  kitDiscountPercent: number
  /** Cuotas sin interés máximas, de 1 a 12. */
  installmentsMax: number
  /** Si las cuotas se muestran en la ficha. */
  installmentsShowOnProduct: boolean
  /** Email de contacto. */
  contactEmail: string
  /** Unidades desde las que se avisa "pocas unidades". */
  lowStockThreshold: number
  /** Alícuota de IVA en porcentaje, de 0 a 100 (admite decimales). */
  vatRatePercent: number
  /** Si se muestra el precio sin impuestos nacionales. */
  showNetPrice: boolean
  /** Datos del vendedor. */
  seller: Seller
  /** Opciones de envío, en el orden del contrato. */
  shippingOptions: ShippingOption[]
}

/** Revisa que un número sea entero y esté en un rango. */
function assertIntegerInRange(value: number, min: number, max: number, message: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${message}; se recibió ${String(value)}.`)
  }
}

/**
 * Crea los ajustes de la tienda validados.
 *
 * @param props - Ajustes leídos de la base.
 * @returns Los mismos ajustes, ya validados.
 * @throws {RangeError} En español, si el descuento, las cuotas, el umbral, la alícuota o un costo
 *   de envío están fuera de rango.
 * @throws {TypeError} En español, si falta el email de contacto.
 */
export function createStoreSettings(props: StoreSettings): StoreSettings {
  assertIntegerInRange(
    props.kitDiscountPercent,
    0,
    30,
    'El descuento del kit tiene que ser un entero de 0 a 30',
  )
  assertIntegerInRange(props.installmentsMax, 1, 12, 'Las cuotas sin interés van de 1 a 12')
  assertIntegerInRange(
    props.lowStockThreshold,
    0,
    Number.MAX_SAFE_INTEGER,
    'El umbral de stock bajo tiene que ser un entero desde 0',
  )
  if (
    !Number.isFinite(props.vatRatePercent) ||
    props.vatRatePercent < 0 ||
    props.vatRatePercent > 100
  ) {
    throw new RangeError(
      `La alícuota de IVA tiene que estar entre 0 y 100; se recibió ${String(props.vatRatePercent)}.`,
    )
  }
  if (props.contactEmail.trim() === '') {
    throw new TypeError('Falta el email de contacto de la tienda.')
  }
  for (const option of props.shippingOptions) {
    assertIntegerInRange(
      option.costArs,
      0,
      Number.MAX_SAFE_INTEGER,
      `El costo del envío ${option.method} tiene que ser un entero desde 0`,
    )
  }
  return props
}
