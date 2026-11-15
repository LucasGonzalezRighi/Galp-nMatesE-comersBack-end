/**
 * Indica si un texto libre se puede guardar tal cual en Postgres: sin U+0000 (que Postgres rechaza
 * en `text` y en `jsonb`) ni mitades sueltas de un par sustituto (que `jsonb` rechaza). Sin este
 * control, un pedido o un arrepentimiento fallaba con 500 después de tomar su número de la
 * secuencia, que se perdía (auditoría NV-15 y NV-12). Los saltos de línea, las tabulaciones y los
 * demás caracteres de control se guardan bien y se aceptan (un comentario puede tener varias
 * líneas).
 *
 * @param value - Texto a revisar.
 * @returns `true` si no tiene U+0000 ni mitades sueltas de un par sustituto.
 * @example
 * isStorableText('Me arrepentí.\nGracias') // true
 * isStorableText('Calle\u0000Falsa') // false
 */
export function isStorableText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return false
  }
  return true
}
