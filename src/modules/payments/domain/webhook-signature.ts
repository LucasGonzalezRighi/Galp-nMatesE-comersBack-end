/** Lo que entra en la firma de una notificación de Mercado Pago. */
export interface SignatureInput {
  /** Cabecera `x-signature` (`ts=<segundos>,v1=<hex>`), o `null`. */
  signatureHeader: string | null
  /** Cabecera `x-request-id`, o `null`. */
  requestId: string | null
  /** `data.id` de la query, o `null`. */
  dataId: string | null
}

/**
 * Diferencia máxima entre el `ts` de `x-signature` y el reloj del back (para atrás o para
 * adelante, por relojes corridos): una firma más vieja se rechaza, así una tupla de cabeceras que
 * alguien vio no se puede repetir para siempre (auditoría NV-05).
 */
export const WEBHOOK_SIGNATURE_TOLERANCE_MS = 5 * 60_000

/** Desde este valor, el `ts` se toma en milisegundos (en segundos sería el año 5138). */
const TS_MILLISECONDS_FROM = 100_000_000_000

/** Separa `ts` y `v1` de la cabecera `x-signature` (cada parte por el primer `=`, con trim). */
function parseSignatureHeader(header: string): { ts: string; v1: string } {
  let ts = ''
  let v1 = ''
  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 'ts') ts = value
    if (key === 'v1') v1 = value
  }
  return { ts, v1 }
}

/**
 * Arma el manifiesto que firma Mercado Pago:
 * `id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;`, omitiendo cada segmento que
 * falta. El HMAC lo calcula la infraestructura (esto es puro).
 *
 * @param input - Cabeceras y `data.id` de la notificación.
 * @returns El manifiesto y el `v1` recibido, o `null` si falta `ts` o `v1`.
 */
export function signatureManifest(
  input: SignatureInput,
): { manifest: string; v1: string; ts: string } | null {
  if (input.signatureHeader === null) return null
  const { ts, v1 } = parseSignatureHeader(input.signatureHeader)
  if (ts === '' || v1 === '') return null
  const segments: string[] = []
  const dataId = (input.dataId ?? '').trim().toLowerCase()
  if (dataId !== '') segments.push(`id:${dataId}`)
  const requestId = (input.requestId ?? '').trim()
  if (requestId !== '') segments.push(`request-id:${requestId}`)
  segments.push(`ts:${ts}`)
  return { manifest: `${segments.join(';')};`, v1, ts }
}

/**
 * Indica si el `ts` firmado está a {@link WEBHOOK_SIGNATURE_TOLERANCE_MS} o menos de `now`. Mercado
 * Pago lo manda en segundos; si llega en milisegundos (13 dígitos) también se entiende.
 *
 * @param ts - El `ts` de `x-signature` (solo dígitos).
 * @param now - Hora del back.
 * @returns `false` si no es un entero o está fuera de la tolerancia.
 */
export function isFreshSignature(ts: string, now: Date): boolean {
  if (!/^[0-9]{1,16}$/.test(ts)) return false
  const value = Number(ts)
  const signedAtMs = value >= TS_MILLISECONDS_FROM ? value : value * 1000
  return Math.abs(now.getTime() - signedAtMs) <= WEBHOOK_SIGNATURE_TOLERANCE_MS
}

/**
 * Compara dos textos recorriendo siempre el más largo, sin cortar en la primera diferencia (para
 * comparar la firma sin filtrar por tiempo cuántos caracteres coinciden).
 *
 * @param a - Primer texto.
 * @param b - Segundo texto.
 * @returns `true` si son iguales.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = index < a.length ? a.charCodeAt(index) : 0
    const right = index < b.length ? b.charCodeAt(index) : 0
    diff |= left ^ right
  }
  return diff === 0
}
