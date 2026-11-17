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
  /** El `href` del código de Data Fiscal que entrega ARCA. */
  dataFiscalUrl: string | null
}

/** Enlaces a Defensa del Consumidor que el pie de la tienda muestra siempre (LS-3). */
export interface ConsumerLinks {
  /** Defensa del Consumidor de la Ciudad de Buenos Aires (Ley 2244). */
  cabaUrl: string
  /** Formulario de reclamos de Defensa del Consumidor de la Nación. */
  nationalUrl: string
}

/** Enlaces de fábrica de Defensa del Consumidor (copia de `DEFAULT_CONSUMER_LINKS` del front). */
export const DEFAULT_CONSUMER_LINKS: Readonly<ConsumerLinks> = {
  cabaUrl: 'https://buenosaires.gob.ar/gobierno/atencion-ciudadana/defensa-al-consumidor',
  nationalUrl: 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario',
}

/** El `href` de un `<a>` con comillas dobles o simples. */
const ANCHOR_HREF = /<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/i

/**
 * Saca el enlace de Data Fiscal de lo que pega el vendedor: el código entero que entrega ARCA
 * (`<a href="…"><img …></a>`) o solo la URL (como `extractDataFiscalUrl` de `@galpon/domain`).
 *
 * @param input - El código o la URL.
 * @returns El `href` del código si lo trae (con `&amp;` como `&`); si no, el texto recortado.
 * @throws {TypeError} En español, si no es un texto.
 */
export function extractDataFiscalUrl(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('El código de Data Fiscal tiene que ser un texto.')
  }
  const match = ANCHOR_HREF.exec(input)
  if (match?.[2] !== undefined) return match[2].replace(/&amp;/g, '&').trim()
  return input.trim()
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
  /** Enlaces a Defensa del Consumidor. */
  consumerLinks: ConsumerLinks
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
 * @throws {TypeError} En español, si falta el email de contacto o un enlace a Defensa del
 *   Consumidor.
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
  if (props.consumerLinks.cabaUrl.trim() === '' || props.consumerLinks.nationalUrl.trim() === '') {
    throw new TypeError('Faltan los enlaces a Defensa del Consumidor.')
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

/**
 * Nombre fijo de cada método de envío: el dashboard no lo cambia (manda `label`, pero el back lo
 * ignora) y una opción que falte se crea con este (`DEFAULT_SHIPPING_OPTIONS` del front).
 */
export const DEFAULT_SHIPPING_LABELS = {
  home: 'Envío a domicilio',
  branch: 'Envío a sucursal',
  pickup: 'Retiro en persona',
} as const satisfies Record<ShippingMethod, string>

/** `reason` del aviso a la tienda de cada guardado de los ajustes (Ruling B-73). */
export const SETTINGS_UPDATED_REASON = 'settings.updated'

/**
 * Etiquetas de la tienda que regenera un guardado de los ajustes (Ruling B-73): los ajustes y,
 * siempre, productos y combos, que traen el precio neto calculado con el IVA y `showNetPrice`.
 */
export const SETTINGS_STOREFRONT_TAGS: readonly string[] = ['settings', 'products', 'combos']

/**
 * Redondea la alícuota de IVA a 2 decimales, con las mitades hacia arriba (10,555 → 10,56), como
 * la guarda la base (`Decimal(5, 2)`, Ruling B-79). Redondea sobre el texto decimal del número (con
 * 10 decimales), así `10.555` (que en binario es un poco menos) no queda en 10,55.
 *
 * @param value - Alícuota en porcentaje, de 0 a 100.
 * @returns La alícuota con 2 decimales como mucho.
 * @throws {RangeError} En español, si no es un número finito de 0 a 100.
 */
export function roundVatRatePercent(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(
      `La alícuota de IVA tiene que estar entre 0 y 100; se recibió ${String(value)}.`,
    )
  }
  return Number(`${String(Math.round(Number(`${value.toFixed(10)}e2`)))}e-2`)
}
