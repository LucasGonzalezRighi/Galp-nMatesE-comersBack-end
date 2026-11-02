import { describe, expect, it } from 'vitest'

import { CryptoSecrets } from './crypto-secrets.adapter'

describe('CryptoSecrets', () => {
  const secrets = new CryptoSecrets()

  it('genera tokens hex en minúsculas del largo pedido y distintos entre sí', () => {
    const first = secrets.token(32)
    const second = secrets.token(32)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).not.toBe(first)
    expect(secrets.token(1)).toMatch(/^[0-9a-f]{2}$/)
  })

  it('rechaza una cantidad de bytes inválida', () => {
    expect(() => secrets.token(0)).toThrow(/bytes/)
    expect(() => secrets.token(2.5)).toThrow(/bytes/)
    expect(() => secrets.token(2048)).toThrow(/bytes/)
  })

  it('calcula el SHA-256 en hex', () => {
    expect(secrets.sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
