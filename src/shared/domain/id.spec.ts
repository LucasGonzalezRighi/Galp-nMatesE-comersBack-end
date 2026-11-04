import { describe, expect, it } from 'vitest'

import { canonicalId, isId, newId } from './id'

describe('canonicalId', () => {
  it('pasa un UUID en mayúsculas (o mezclado) a minúsculas', () => {
    expect(canonicalId('0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B')).toBe(
      '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
    expect(canonicalId('0190a1b2-C3D4-7e5f-8A9B-0c1d2e3f4a5b')).toBe(
      '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
  })

  it('deja igual un id nuevo y cualquier texto que no es un UUID', () => {
    const id = newId()

    expect(canonicalId(id)).toBe(id)
    expect(isId(canonicalId(id.toUpperCase()))).toBe(true)
    for (const text of ['cmb-Duo-Imperial', 'PRD-X', '', ' 0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B']) {
      expect(canonicalId(text)).toBe(text)
    }
  })
})
