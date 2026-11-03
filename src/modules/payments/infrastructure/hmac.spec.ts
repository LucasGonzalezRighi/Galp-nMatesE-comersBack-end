import { describe, expect, it } from 'vitest'

import { signatureManifest } from '../domain/webhook-signature'
import { hmacSha256Hex } from './hmac'

describe('hmacSha256Hex', () => {
  it('da el HMAC-SHA256 en hex en minúsculas (vector de la RFC 4231, caso 2)', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('firma el manifiesto de Mercado Pago (data.id en minúsculas, segmentos ausentes fuera)', () => {
    const header = 'ts=1704908010,v1=x'
    const lower = signatureManifest({ signatureHeader: header, requestId: 'r-1', dataId: 'ABC' })
    const without = signatureManifest({ signatureHeader: header, requestId: null, dataId: null })

    expect(lower?.manifest).toBe('id:abc;request-id:r-1;ts:1704908010;')
    expect(without?.manifest).toBe('ts:1704908010;')
    expect(hmacSha256Hex('secreto', lower?.manifest ?? '')).toMatch(/^[0-9a-f]{64}$/)
    expect(hmacSha256Hex('secreto', 'a')).not.toBe(hmacSha256Hex('otro', 'a'))
  })

  it('un secreto vacío es un error de programación', () => {
    expect(() => hmacSha256Hex('', 'ts:1;')).toThrow('El secreto del HMAC no puede estar vacío')
  })
})
