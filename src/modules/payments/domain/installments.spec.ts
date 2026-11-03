import { describe, expect, it } from 'vitest'

import {
  EXAMPLE_CFT_PERCENT,
  EXAMPLE_TEA_PERCENT,
  FINANCED_INSTALLMENTS,
  formatPercentAr,
  parseInstallmentLabels,
  simulatedInstallments,
} from './installments'

const ONE_PAYMENT = {
  installments: 1,
  installmentAmountArs: 68397,
  totalArs: 68397,
  cftPercent: 0,
  teaPercent: 0,
  label: '1 pago de $68.397',
}

describe('simulatedInstallments (tabla del mock)', () => {
  it('crédito con 3 sin interés: 1, 2 y 3 sin interés más 6 y 12 con CFT 45,90 %', () => {
    expect(FINANCED_INSTALLMENTS).toEqual([6, 12])
    expect(EXAMPLE_CFT_PERCENT).toBe(45.9)
    expect(EXAMPLE_TEA_PERCENT).toBe(38)
    expect(simulatedInstallments(68397, 3, true)).toEqual([
      ONE_PAYMENT,
      {
        installments: 2,
        installmentAmountArs: 34199,
        totalArs: 68397,
        cftPercent: 0,
        teaPercent: 0,
        label: '2 cuotas sin interés de $34.199',
      },
      {
        installments: 3,
        installmentAmountArs: 22799,
        totalArs: 68397,
        cftPercent: 0,
        teaPercent: 0,
        label: '3 cuotas sin interés de $22.799',
      },
      {
        installments: 6,
        installmentAmountArs: 12509,
        totalArs: 75055,
        cftPercent: 45.9,
        teaPercent: 38,
        label: '6 cuotas de $12.509 (CFT 45,90 %)',
      },
      {
        installments: 12,
        installmentAmountArs: 6757,
        totalArs: 81085,
        cftPercent: 45.9,
        teaPercent: 38,
        label: '12 cuotas de $6.757 (CFT 45,90 %)',
      },
    ])
  })

  it('las 3 cuotas sin interés de $68.397 son de $22.799 cada una', () => {
    const amount = simulatedInstallments(68397, 3, true)[2]?.installmentAmountArs
    expect([amount, amount, amount]).toEqual([22799, 22799, 22799])
  })

  it('débito: solo 1 pago', () => {
    expect(simulatedInstallments(68397, 3, false)).toEqual([ONE_PAYMENT])
  })

  it('con 6 o más sin interés no repite las financiadas', () => {
    expect(simulatedInstallments(1200, 6, true).map((option) => option.installments)).toEqual([
      1, 2, 3, 4, 5, 6, 12,
    ])
    expect(simulatedInstallments(1200, 12, true)).toHaveLength(12)
  })

  it('valida el total y el máximo sin interés', () => {
    expect(() => simulatedInstallments(-1, 3, true)).toThrow(
      'El total tiene que ser un entero no negativo (llegó -1)',
    )
    expect(() => simulatedInstallments(100, 0, true)).toThrow(
      'El máximo de cuotas sin interés tiene que ser un entero entre 1 y 24 (llegó 0)',
    )
  })
})

describe('parseInstallmentLabels', () => {
  it("lee el CFT y la TEA de 'CFT_45,90%|TEA_38,00%'", () => {
    expect(parseInstallmentLabels(['CFT_45,90%|TEA_38,00%'])).toEqual({
      cftPercent: 45.9,
      teaPercent: 38,
    })
  })

  it('busca entre varias etiquetas y da 0 si no están', () => {
    expect(parseInstallmentLabels(['recommended_installment', 'CFT_0,00%|TEA_0,00%'])).toEqual({
      cftPercent: 0,
      teaPercent: 0,
    })
    expect(parseInstallmentLabels(['recommended_installment'])).toEqual({
      cftPercent: 0,
      teaPercent: 0,
    })
    expect(parseInstallmentLabels([])).toEqual({ cftPercent: 0, teaPercent: 0 })
  })

  it('acepta miles con punto y decimales con punto', () => {
    expect(parseInstallmentLabels(['CFT_1.234,56%|TEA_99.5%'])).toEqual({
      cftPercent: 1234.56,
      teaPercent: 99.5,
    })
  })
})

describe('formatPercentAr', () => {
  it('dos decimales con coma y espacio antes del %', () => {
    expect(formatPercentAr(45.9)).toBe('45,90 %')
    expect(formatPercentAr(0)).toBe('0,00 %')
  })

  it('rechaza lo que no es un número finito', () => {
    expect(() => formatPercentAr(Number.POSITIVE_INFINITY)).toThrow(
      'El porcentaje tiene que ser un número finito (llegó Infinity)',
    )
  })
})
