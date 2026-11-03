/** Token de tarjeta del simulador: `sim_<TITULAR>_<últimos 4 o xxxx>_<32 hex>` (como el mock). */
export const SIMULATED_TOKEN_PATTERN = /^sim_([A-Z0-9]+)_(\d{4}|xxxx)_[0-9a-f]{32}$/

/** Estado crudo de Mercado Pago que devuelve el simulador. */
export interface SimulatedOutcome {
  /** `status` crudo (`approved`, `pending` o `rejected`). */
  status: string
  /** `status_detail` crudo. */
  statusDetail: string
}

/** Resultado de cada titular de prueba (Ruling B-55); cualquier otro titular es `OTHE`. */
export const SIMULATED_CARD_OUTCOMES: Readonly<Record<string, SimulatedOutcome>> = {
  APRO: { status: 'approved', statusDetail: 'accredited' },
  CONT: { status: 'pending', statusDetail: 'pending_contingency' },
  OTHE: { status: 'rejected', statusDetail: 'cc_rejected_other_reason' },
  FUND: { status: 'rejected', statusDetail: 'cc_rejected_insufficient_amount' },
  SECU: { status: 'rejected', statusDetail: 'cc_rejected_bad_filled_security_code' },
  EXPI: { status: 'rejected', statusDetail: 'cc_rejected_bad_filled_date' },
  CALL: { status: 'rejected', statusDetail: 'cc_rejected_call_for_authorize' },
  '3DS': { status: 'pending', statusDetail: 'pending_challenge' },
}

/** Resultados que se eligen en las páginas del simulador (checkout y desafío 3-D Secure). */
export const SIMULATOR_RESULTS = [
  'approved',
  'pending',
  'rejected',
  'challenge_ok',
  'challenge_failed',
] as const

/** Resultado elegido en el simulador. */
export type SimulatorResult = (typeof SIMULATOR_RESULTS)[number]

const SIMULATOR_OUTCOMES: Readonly<Record<SimulatorResult, SimulatedOutcome>> = {
  approved: { status: 'approved', statusDetail: 'accredited' },
  pending: { status: 'pending', statusDetail: 'pending_waiting_payment' },
  rejected: { status: 'rejected', statusDetail: 'cc_rejected_other_reason' },
  challenge_ok: { status: 'approved', statusDetail: 'accredited' },
  challenge_failed: { status: 'rejected', statusDetail: 'cc_rejected_3ds_challenge' },
}

/**
 * Lee un token del simulador.
 *
 * @param token - Token que mandó la tienda.
 * @returns Titular y últimos 4 (`null` si vienen como `xxxx`), o `null` si no es un token `sim_`.
 */
export function parseSimulatedToken(
  token: string,
): { holder: string; lastFour: string | null } | null {
  const match = SIMULATED_TOKEN_PATTERN.exec(token)
  const holder = match?.[1]
  const lastFour = match?.[2]
  if (holder === undefined || lastFour === undefined) return null
  return { holder, lastFour: lastFour === 'xxxx' ? null : lastFour }
}

/**
 * Resultado de un pago con tarjeta simulado según el titular (sin espacios y en mayúsculas).
 *
 * @param holder - Titular de la tarjeta de prueba (`APRO`, `3DS`…).
 * @returns `status` y `status_detail` crudos de Mercado Pago; un titular desconocido es `OTHE`.
 */
export function simulatedOutcome(holder: string): SimulatedOutcome {
  const outcome =
    SIMULATED_CARD_OUTCOMES[holder.trim().toUpperCase()] ?? SIMULATED_CARD_OUTCOMES.OTHE
  return { status: outcome?.status ?? 'rejected', statusDetail: outcome?.statusDetail ?? '' }
}

/**
 * Estado crudo que aplica una elección de las páginas del simulador.
 *
 * @param result - Botón elegido.
 * @returns `status` y `status_detail` crudos de Mercado Pago.
 * @throws {TypeError} En español, si el resultado no es uno del simulador.
 */
export function simulatorOutcome(result: SimulatorResult): SimulatedOutcome {
  if (!(SIMULATOR_RESULTS as readonly string[]).includes(result)) {
    throw new TypeError(`El resultado "${result}" no es uno del simulador`)
  }
  return { ...SIMULATOR_OUTCOMES[result] }
}

/**
 * Id de pago simulado: 10 dígitos que no empiezan con 0, como los de Mercado Pago.
 *
 * @param random - Generador en [0, 1) (por defecto `Math.random`; los tests lo fijan).
 * @returns El id.
 * @throws {RangeError} En español, si el generador sale de [0, 1).
 */
export function newSimulatedPaymentId(random: () => number = Math.random): string {
  const value = random()
  if (!(value >= 0 && value < 1)) {
    throw new RangeError(`El generador tiene que dar un número en [0, 1) (dio ${String(value)})`)
  }
  return String(1_000_000_000 + Math.floor(value * 9_000_000_000))
}
