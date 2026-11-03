import { describe, expect, it } from 'vitest'

import {
  formatOrderNumber,
  HONEYPOT_ORDER_NUMBER,
  isOrderNumber,
  ORDER_NUMBER_SEQUENCE_START,
} from './order-number'

describe('formatOrderNumber', () => {
  it('arma GLP- y cinco dígitos desde la secuencia', () => {
    expect(formatOrderNumber(ORDER_NUMBER_SEQUENCE_START)).toBe('GLP-10001')
    expect(formatOrderNumber(99_999)).toBe('GLP-99999')
    expect(formatOrderNumber(9001)).toBe('GLP-09001')
    expect(formatOrderNumber(0)).toBe(HONEYPOT_ORDER_NUMBER)
  })

  it('lanza cuando no quedan números o el valor no es un entero', () => {
    expect(() => formatOrderNumber(100_000)).toThrow(new RangeError('No quedan números de pedido.'))
    expect(() => formatOrderNumber(-1)).toThrow(RangeError)
    expect(() => formatOrderNumber(1.5)).toThrow(RangeError)
  })
})

describe('isOrderNumber', () => {
  it('compara exacto, sin recortar ni cambiar mayúsculas', () => {
    expect(isOrderNumber('GLP-10001')).toBe(true)
    expect(isOrderNumber('GLP-123')).toBe(false)
    expect(isOrderNumber('glp-10001')).toBe(false)
    expect(isOrderNumber(' GLP-10001')).toBe(false)
    expect(isOrderNumber(10001)).toBe(false)
  })
})
