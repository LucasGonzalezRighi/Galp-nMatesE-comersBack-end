import { describe, expect, it } from 'vitest'

import {
  constantTimeEqual,
  isFreshSignature,
  signatureManifest,
  WEBHOOK_SIGNATURE_TOLERANCE_MS,
} from './webhook-signature'

describe('signatureManifest', () => {
  it('arma id;request-id;ts y separa v1', () => {
    expect(
      signatureManifest({
        signatureHeader: 'ts=1704908010,v1=abc123',
        requestId: 'req-1',
        dataId: '1234567890',
      }),
    ).toEqual({
      manifest: 'id:1234567890;request-id:req-1;ts:1704908010;',
      v1: 'abc123',
      ts: '1704908010',
    })
  })

  it('tolera espacios alrededor de , y =', () => {
    expect(
      signatureManifest({
        signatureHeader: ' ts = 1704908010 , v1 = abc ',
        requestId: 'req-1',
        dataId: '1',
      }),
    ).toEqual({ manifest: 'id:1;request-id:req-1;ts:1704908010;', v1: 'abc', ts: '1704908010' })
  })

  it('sin data.id ni x-request-id omite esos segmentos', () => {
    expect(
      signatureManifest({
        signatureHeader: 'ts=1704908010,v1=abc',
        requestId: 'req-1',
        dataId: null,
      }),
    ).toEqual({ manifest: 'request-id:req-1;ts:1704908010;', v1: 'abc', ts: '1704908010' })
    expect(
      signatureManifest({ signatureHeader: 'ts=1704908010,v1=abc', requestId: '', dataId: '' }),
    ).toEqual({ manifest: 'ts:1704908010;', v1: 'abc', ts: '1704908010' })
  })

  it('pasa data.id a minúsculas', () => {
    expect(
      signatureManifest({ signatureHeader: 'ts=1,v1=abc', requestId: null, dataId: 'ABC123' })
        ?.manifest,
    ).toBe('id:abc123;ts:1;')
  })

  it.each([null, '', 'v1=abc', 'ts=1', 'ts=,v1=abc', 'ts=1,v1= ', 'basura'])(
    'sin ts o v1 (%s) da null',
    (signatureHeader) => {
      expect(signatureManifest({ signatureHeader, requestId: 'req-1', dataId: '1' })).toBeNull()
    },
  )
})

describe('isFreshSignature', () => {
  const now = new Date('2026-11-02T12:00:00.000Z')
  const seconds = (ms: number) => String(Math.floor(ms / 1000))

  it('acepta hasta 5 minutos para atrás o para adelante, en segundos o en milisegundos', () => {
    expect(WEBHOOK_SIGNATURE_TOLERANCE_MS).toBe(300_000)
    expect(isFreshSignature(seconds(now.getTime()), now)).toBe(true)
    expect(isFreshSignature(seconds(now.getTime() - 300_000), now)).toBe(true)
    expect(isFreshSignature(seconds(now.getTime() + 300_000), now)).toBe(true)
    expect(isFreshSignature(String(now.getTime() - 300_000), now)).toBe(true)
  })

  it('rechaza más de 5 minutos, un ts que no es un entero y el de 2024 de la documentación', () => {
    expect(isFreshSignature(seconds(now.getTime() - 301_000), now)).toBe(false)
    expect(isFreshSignature(seconds(now.getTime() + 301_000), now)).toBe(false)
    expect(isFreshSignature(String(now.getTime() - 300_001), now)).toBe(false)
    expect(isFreshSignature('1704908010', now)).toBe(false)
    for (const ts of ['', 'abc', '-1', '1.5', '1e9', '9'.repeat(17)]) {
      expect(isFreshSignature(ts, now)).toBe(false)
    }
  })
})

describe('constantTimeEqual', () => {
  it('compara textos completos', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
