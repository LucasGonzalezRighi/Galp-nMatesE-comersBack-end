import { describe, expect, it } from 'vitest'

import { constantTimeEqual, signatureManifest } from './webhook-signature'

describe('signatureManifest', () => {
  it('arma id;request-id;ts y separa v1', () => {
    expect(
      signatureManifest({
        signatureHeader: 'ts=1704908010,v1=abc123',
        requestId: 'req-1',
        dataId: '1234567890',
      }),
    ).toEqual({ manifest: 'id:1234567890;request-id:req-1;ts:1704908010;', v1: 'abc123' })
  })

  it('tolera espacios alrededor de , y =', () => {
    expect(
      signatureManifest({
        signatureHeader: ' ts = 1704908010 , v1 = abc ',
        requestId: 'req-1',
        dataId: '1',
      }),
    ).toEqual({ manifest: 'id:1;request-id:req-1;ts:1704908010;', v1: 'abc' })
  })

  it('sin data.id ni x-request-id omite esos segmentos', () => {
    expect(
      signatureManifest({
        signatureHeader: 'ts=1704908010,v1=abc',
        requestId: 'req-1',
        dataId: null,
      }),
    ).toEqual({ manifest: 'request-id:req-1;ts:1704908010;', v1: 'abc' })
    expect(
      signatureManifest({ signatureHeader: 'ts=1704908010,v1=abc', requestId: '', dataId: '' }),
    ).toEqual({ manifest: 'ts:1704908010;', v1: 'abc' })
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

describe('constantTimeEqual', () => {
  it('compara textos completos', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
