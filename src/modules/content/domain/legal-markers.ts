/**
 * Claves de los marcadores `{{clave}}` que puede usar un documento legal: la tienda los reemplaza
 * por los datos del vendedor al dibujar (copia de `LEGAL_MARKERS` de `@galpon/domain`).
 */
export const LEGAL_MARKERS = [
  'razon_social',
  'cuit',
  'condicion_iva',
  'domicilio',
  'email',
  'telefono',
  'area_atencion',
  'horario_atencion',
] as const

/** Clave de un marcador de datos del vendedor. */
export type LegalMarker = (typeof LEGAL_MARKERS)[number]

/** Un marcador: `{{clave}}`, sin llaves adentro (el mismo patrón que el front). */
const MARKER_PATTERN = /\{\{([^{}]*)\}\}/g

/**
 * Busca los marcadores de un cuerpo legal cuya clave no existe. Todo `{{…}}` cuenta como marcador.
 *
 * @param body - Cuerpo del documento.
 * @returns Las claves desconocidas, recortadas, sin repetir y en orden de aparición.
 * @throws {TypeError} En español, si el cuerpo no es un texto.
 */
export function unknownLegalMarkers(body: string): string[] {
  if (typeof body !== 'string') {
    throw new TypeError('El cuerpo del documento legal tiene que ser un texto.')
  }
  const unknown: string[] = []
  for (const match of body.matchAll(MARKER_PATTERN)) {
    const key = (match[1] ?? '').trim()
    if (!(LEGAL_MARKERS as readonly string[]).includes(key) && !unknown.includes(key)) {
      unknown.push(key)
    }
  }
  return unknown
}

/**
 * Mensaje de un marcador que no existe (`MESSAGES.unknownLegalMarker` del front).
 *
 * @param marker - Clave desconocida, sin las llaves.
 * @returns `El dato {{<clave>}} no existe. Revisá la lista de datos del vendedor.`
 */
export function unknownLegalMarkerMessage(marker: string): string {
  return `El dato {{${marker}}} no existe. Revisá la lista de datos del vendedor.`
}
