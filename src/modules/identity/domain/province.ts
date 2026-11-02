/** Provincias y jurisdicciones de entrega, con el texto exacto del contrato (las 24, con CABA). */
export const PROVINCES = [
  'Buenos Aires',
  'CABA',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const

/** Provincia o jurisdicción de entrega. */
export type Province = (typeof PROVINCES)[number]

/**
 * Indica si un texto es una provincia del contrato (con acentos y mayúsculas exactos).
 *
 * @param value - Texto a revisar.
 * @returns `true` si es una {@link Province}.
 */
export function isProvince(value: string): value is Province {
  return (PROVINCES as readonly string[]).includes(value)
}
