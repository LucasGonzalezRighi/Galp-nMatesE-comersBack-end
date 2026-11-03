import { describe, expect, it } from 'vitest'

import { formatPesos } from './format-pesos'

describe('formatPesos', () => {
  it('formatea pesos enteros como la tienda', () => {
    expect(formatPesos(46499)).toBe('$46.499')
    expect(formatPesos(39999)).toBe('$39.999')
    expect(formatPesos(6500)).toBe('$6.500')
    expect(formatPesos(0)).toBe('$0')
  })

  it('rechaza montos negativos o con decimales', () => {
    expect(() => formatPesos(-1)).toThrow(RangeError)
    expect(() => formatPesos(1.5)).toThrow(RangeError)
  })
})
