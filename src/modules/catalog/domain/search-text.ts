/** Marcas diacríticas (tildes, diéresis, tilde de la eñe) que quedan sueltas tras `NFD`. */
const DIACRITICS = /\p{Diacritic}/gu

/**
 * Normaliza un texto para buscar, como el front (`normalizeSearchText` de su dominio): sin
 * acentos, en minúsculas y con los espacios colapsados.
 *
 * @param text - Texto original.
 * @returns El texto normalizado, sin espacios al principio ni al final.
 * @example
 * normalizeSearchText('  BOMBILLÓN   Curvo ') // "bombillon curvo"
 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
