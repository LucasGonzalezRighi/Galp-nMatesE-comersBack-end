import { describe, expect, it } from 'vitest'

import { isStorableText } from './storable-text'

describe('isStorableText', () => {
  it('acepta texto común, acentos, emojis y comillas', () => {
    for (const text of ['Av. Corrientes 1234', 'Ñuñoa, 5° B', 'Me arrepentí 🧉', "O'Higgins ’"]) {
      expect(isStorableText(text)).toBe(true)
    }
  })

  it('acepta saltos de línea y tabulaciones: un comentario de varias líneas se guarda bien', () => {
    for (const text of ['Me arrepentí.\nGracias', 'línea\r\nnueva', 'tab\t', 'campana\u0007']) {
      expect(isStorableText(text)).toBe(true)
    }
  })

  it('rechaza U+0000 y mitades sueltas de un par sustituto (Postgres no los guarda)', () => {
    for (const text of ['Calle\u0000Falsa', '\u0000', 'a\ud800b', '\udfff', 'b\ud83d']) {
      expect(isStorableText(text)).toBe(false)
    }
  })
})
