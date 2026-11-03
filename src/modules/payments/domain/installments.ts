import { formatPesos } from '../../../shared/domain/format-pesos'

/** Una opción de cuotas (`InstallmentOption` del contrato). */
export interface InstallmentOption {
  /** Cantidad de cuotas (1 es un solo pago). */
  installments: number
  /** Importe de cada cuota, en pesos enteros. */
  installmentAmountArs: number
  /** Total con el costo financiero incluido, en pesos enteros. */
  totalArs: number
  /** CFT en porcentaje (0 sin interés). */
  cftPercent: number
  /** TEA en porcentaje (0 sin interés). */
  teaPercent: number
  /** Texto informativo de la opción. */
  label: string
}

/** Cuotas con interés que ofrece el simulador además de las sin interés. */
export const FINANCED_INSTALLMENTS = [6, 12] as const

/** CFT de ejemplo de las cuotas con interés del simulador. */
export const EXAMPLE_CFT_PERCENT = 45.9

/** TEA de ejemplo de las cuotas con interés del simulador (sistema francés). */
export const EXAMPLE_TEA_PERCENT = 38

/** Dos decimales con coma decimal, como la leyenda de cuotas. */
const PERCENT_FORMAT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'negative',
})

/** Máximo de cuotas del contrato (`InstallmentOption.installments`). */
const MAX_INSTALLMENTS = 24

/**
 * Formatea un porcentaje como la leyenda de cuotas: `45,90 %`.
 *
 * @param value - Porcentaje.
 * @returns Dos decimales, coma decimal y un espacio antes del `%`.
 * @throws {RangeError} En español, si no es un número finito.
 */
export function formatPercentAr(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`El porcentaje tiene que ser un número finito (llegó ${String(value)})`)
  }
  return `${PERCENT_FORMAT.format(value)} %`
}

/**
 * Cuotas del simulador, iguales a las del mock del front: de 1 a `maxWithoutInterest` sin interés
 * (débito: solo 1 pago) y, con crédito, 6 y 12 con el CFT y la TEA de ejemplo por sistema francés.
 *
 * @param totalArs - Total del pedido, en pesos enteros.
 * @param maxWithoutInterest - Máximo de cuotas sin interés (`settings.installmentsMax`).
 * @param credit - `true` para crédito, `false` para débito.
 * @returns Las opciones, de menos a más cuotas.
 * @throws {RangeError} En español, si el total o el máximo no son válidos.
 */
export function simulatedInstallments(
  totalArs: number,
  maxWithoutInterest: number,
  credit: boolean,
): InstallmentOption[] {
  if (!Number.isSafeInteger(totalArs) || totalArs < 0) {
    throw new RangeError(`El total tiene que ser un entero no negativo (llegó ${String(totalArs)})`)
  }
  if (
    !Number.isInteger(maxWithoutInterest) ||
    maxWithoutInterest < 1 ||
    maxWithoutInterest > MAX_INSTALLMENTS
  ) {
    throw new RangeError(
      `El máximo de cuotas sin interés tiene que ser un entero entre 1 y ${String(MAX_INSTALLMENTS)} (llegó ${String(maxWithoutInterest)})`,
    )
  }
  const options: InstallmentOption[] = []
  const free = credit ? maxWithoutInterest : 1
  for (let count = 1; count <= free; count += 1) {
    const amount = Math.round(totalArs / count)
    options.push({
      installments: count,
      installmentAmountArs: amount,
      totalArs,
      cftPercent: 0,
      teaPercent: 0,
      label:
        count === 1
          ? `1 pago de ${formatPesos(amount)}`
          : `${String(count)} cuotas sin interés de ${formatPesos(amount)}`,
    })
  }
  if (!credit) return options
  const monthlyRate = (1 + EXAMPLE_TEA_PERCENT / 100) ** (1 / 12) - 1
  for (const count of FINANCED_INSTALLMENTS) {
    if (count <= maxWithoutInterest) continue
    const financed = Math.round(
      (totalArs * count * monthlyRate) / (1 - (1 + monthlyRate) ** -count),
    )
    const amount = Math.round(financed / count)
    options.push({
      installments: count,
      installmentAmountArs: amount,
      totalArs: financed,
      cftPercent: EXAMPLE_CFT_PERCENT,
      teaPercent: EXAMPLE_TEA_PERCENT,
      label: `${String(count)} cuotas de ${formatPesos(amount)} (CFT ${formatPercentAr(EXAMPLE_CFT_PERCENT)})`,
    })
  }
  return options
}

/** Lee un porcentaje de Mercado Pago (`45,90`, `1.234,56` o `99.5`). */
function parsePercent(raw: string): number {
  const normalized = raw.includes(',') ? raw.replaceAll('.', '').replace(',', '.') : raw
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

/**
 * Lee el CFT y la TEA de las `labels` de un `payer_costs[]` de Mercado Pago, con el formato
 * `CFT_45,90%|TEA_38,00%` (Ruling B-50).
 *
 * @param labels - Etiquetas de la opción.
 * @returns CFT y TEA en porcentaje; 0 los que no aparecen.
 */
export function parseInstallmentLabels(labels: readonly string[]): {
  cftPercent: number
  teaPercent: number
} {
  let cftPercent = 0
  let teaPercent = 0
  for (const label of labels) {
    for (const part of label.split('|')) {
      const match = /^(CFT|TEA)_([\d.,]+)%$/.exec(part.trim())
      if (match?.[1] === 'CFT') cftPercent = parsePercent(match[2] ?? '')
      if (match?.[1] === 'TEA') teaPercent = parsePercent(match[2] ?? '')
    }
  }
  return { cftPercent, teaPercent }
}
