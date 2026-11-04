import { describe, expect, it } from 'vitest'

import {
  COMBO_MAX_ITEMS,
  COMBO_MIN_ITEMS,
  COMBO_STATUSES,
  comboHasMate,
  comboLineAmounts,
  comboPriceNotBelowSumMessage,
  comboSavings,
  hasDistinctGroups,
  isComboStatus,
} from './combo.entity'

/** Piezas del "Dúo Imperial": Mate Imperial Premium y Bombillón Premium Curvo. */
const DUO_IMPERIAL = [39999, 28999] as const

describe('constantes del combo', () => {
  it('un combo lleva de 2 a 3 productos y es borrador o publicado', () => {
    expect(COMBO_MIN_ITEMS).toBe(2)
    expect(COMBO_MAX_ITEMS).toBe(3)
    expect(COMBO_STATUSES).toEqual(['draft', 'published'])
  })

  it('isComboStatus reconoce solo los estados del combo', () => {
    expect(isComboStatus('draft')).toBe(true)
    expect(isComboStatus('published')).toBe(true)
    expect(isComboStatus('archived')).toBe(false)
  })
})

describe('comboSavings', () => {
  it('es la suma de las piezas menos el precio del combo', () => {
    expect(comboSavings(68998, 61999)).toBe(6999)
  })

  it('nunca es negativo: si las piezas ya suman menos que el combo, es 0', () => {
    expect(comboSavings(54999, 61999)).toBe(0)
    expect(comboSavings(61999, 61999)).toBe(0)
  })

  it('rechaza montos que no son pesos enteros no negativos', () => {
    expect(() => comboSavings(-1, 61999)).toThrow(RangeError)
    expect(() => comboSavings(68998, 1.5)).toThrow(RangeError)
  })
})

describe('comboLineAmounts', () => {
  it('"Dúo Imperial" × 2: lista 68.998 por combo, ahorro 13.998 y total 123.998', () => {
    expect(comboLineAmounts(DUO_IMPERIAL, 61999, 2)).toEqual({
      grossArs: 137996,
      savingsArs: 13998,
      totalArs: 123998,
    })
  })

  it('con tres piezas el ahorro es por combo y se multiplica por la cantidad', () => {
    const torpedo = [37999, 25999, 12500]
    expect(comboLineAmounts(torpedo, 67999, 1)).toEqual({
      grossArs: 76498,
      savingsArs: 8499,
      totalArs: 67999,
    })
    expect(comboLineAmounts(torpedo, 67999, 3).savingsArs).toBe(3 * 8499)
  })

  it('si una pieza baja y la suma queda por debajo del precio, se cobra el combo sin ahorro', () => {
    expect(comboLineAmounts([39999, 15000], 61999, 2)).toEqual({
      grossArs: 123998,
      savingsArs: 0,
      totalArs: 123998,
    })
  })

  it('el total es siempre el bruto menos el ahorro', () => {
    const amounts = comboLineAmounts(DUO_IMPERIAL, 61999, 5)
    expect(amounts.totalArs).toBe(amounts.grossArs - amounts.savingsArs)
  })

  it.each([[[39999]], [[1, 2, 3, 4]], [[]]])('rechaza un combo de %j piezas', (pieces) => {
    expect(() => comboLineAmounts(pieces, 61999, 1)).toThrow(
      new RangeError(`Un combo lleva de 2 a 3 productos; se recibieron ${String(pieces.length)}.`),
    )
  })

  it.each([[0], [-1], [1.5], [Number.NaN]])('rechaza la cantidad %j', (quantity) => {
    expect(() => comboLineAmounts(DUO_IMPERIAL, 61999, quantity)).toThrow(RangeError)
  })

  it('rechaza un precio de combo en 0', () => {
    expect(() => comboLineAmounts(DUO_IMPERIAL, 0, 1)).toThrow(
      new RangeError('El precio del combo tiene que ser mayor a 0; se recibió 0.'),
    )
  })

  it('rechaza el precio de una pieza que no es un entero no negativo', () => {
    expect(() => comboLineAmounts([39999, -1], 61999, 1)).toThrow(RangeError)
    expect(() => comboLineAmounts([39999, 0.5], 61999, 1)).toThrow(RangeError)
  })
})

describe('hasDistinctGroups', () => {
  it.each([[['mate', 'bombilla']], [['yerba', 'mate']], [['mate', 'bombilla', 'yerba']]] as const)(
    'acepta %j',
    (groups) => {
      expect(hasDistinctGroups(groups)).toBe(true)
    },
  )

  it.each([[['mate', 'mate']], [['bombilla', 'yerba', 'bombilla']]] as const)(
    'rechaza %j: dos productos del mismo grupo',
    (groups) => {
      expect(hasDistinctGroups(groups)).toBe(false)
    },
  )
})

describe('comboHasMate', () => {
  it('indica si alguna pieza es un mate', () => {
    expect(comboHasMate(['mate', 'bombilla'])).toBe(true)
    expect(comboHasMate(['bombilla', 'yerba'])).toBe(false)
  })
})

describe('comboPriceNotBelowSumMessage', () => {
  it('lleva la suma de las piezas con el formato de la tienda', () => {
    expect(comboPriceNotBelowSumMessage(68998)).toBe(
      'El precio del combo tiene que ser menor que la suma de los productos ($68.998)',
    )
  })

  it('rechaza una suma que no es un entero no negativo', () => {
    expect(() => comboPriceNotBelowSumMessage(1.5)).toThrow(RangeError)
  })
})
