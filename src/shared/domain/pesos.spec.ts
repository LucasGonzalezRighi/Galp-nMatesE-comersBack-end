import { describe, expect, it } from 'vitest'

import { Pesos } from './pesos'

describe('Pesos', () => {
  it('suma dos montos', () => {
    expect(Pesos.of(1500).add(Pesos.of(250)).toNumber()).toBe(1750)
  })

  it('multiplica por una cantidad entera', () => {
    expect(Pesos.of(1200).multiply(3).toNumber()).toBe(3600)
    expect(Pesos.of(1200).multiply(0).toNumber()).toBe(0)
  })

  it('aplica un porcentaje de descuento redondeando el ahorro al peso', () => {
    expect(Pesos.of(1999).percentOff(15).toNumber()).toBe(1699)
    expect(Pesos.of(1000).percentOff(0).toNumber()).toBe(1000)
    expect(Pesos.of(1000).percentOff(100).toNumber()).toBe(0)
  })

  it('redondea el ahorro, no el total, igual que el front (kit.ts: total - round(total * p / 100))', () => {
    // 1250 con 15% ahorra 187,5: el ahorro redondea a 188 y el total queda en 1062.
    expect(Pesos.of(1250).percentOf(15).toNumber()).toBe(188)
    expect(Pesos.of(1250).percentOff(15).toNumber()).toBe(1062)
    expect(Pesos.of(1250).percentOff(15).add(Pesos.of(1250).percentOf(15)).toNumber()).toBe(1250)
  })

  it('rechaza decimales y negativos con un RangeError en español', () => {
    expect(() => Pesos.of(1.5)).toThrow(RangeError)
    expect(() => Pesos.of(1.5)).toThrow(/entero/)
    expect(() => Pesos.of(-1)).toThrow(RangeError)
    expect(() => Pesos.of(-1)).toThrow(/negativo/)
    expect(() => Pesos.of(Number.NaN)).toThrow(RangeError)
  })

  it('rechaza un porcentaje fuera de 0 a 100 y un factor que no es entero no negativo', () => {
    expect(() => Pesos.of(100).percentOff(-5)).toThrow(RangeError)
    expect(() => Pesos.of(100).percentOff(120)).toThrow(/porcentaje/)
    expect(() => Pesos.of(100).percentOf(-5)).toThrow(RangeError)
    expect(() => Pesos.of(100).percentOf(120)).toThrow(/porcentaje/)
    expect(() => Pesos.of(100).multiply(1.5)).toThrow(RangeError)
    expect(() => Pesos.of(100).multiply(-2)).toThrow(RangeError)
  })

  it('es inmutable: las operaciones devuelven un monto nuevo', () => {
    const price = Pesos.of(500)
    price.add(Pesos.of(100))
    expect(price.toNumber()).toBe(500)
  })
})
