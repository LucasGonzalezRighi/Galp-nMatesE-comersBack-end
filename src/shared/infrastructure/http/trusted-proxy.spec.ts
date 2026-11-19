import { describe, expect, it, vi } from 'vitest'

import {
  CLIENT_IP_FROM_FORWARDED_FOR,
  CLIENT_IP_FROM_HEADER,
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  type ProxyClaims,
  proxyOriginOf,
  proxyOriginResolver,
  trustedProxyMiddleware,
} from './trusted-proxy'

/** Secreto compartido de mentira (40 caracteres). */
const SECRET = 'secreto-compartido-con-la-tienda-0123456'

/** IP del socket del pedido de prueba (la del proxy de Render, por ejemplo). */
const SOCKET_IP = '10.0.0.9'

/** Lo que dice un pedido sin ninguna de las cabeceras. */
const NOTHING: ProxyClaims = {
  secret: undefined,
  clientIp: undefined,
  clientIpFrom: undefined,
  forwardedFor: undefined,
}

/** Pedido de mentira: como en Express, `ip` es un getter del prototipo. */
class FakeRequest {
  constructor(readonly headers: Record<string, string | string[] | undefined>) {}

  /** @returns La IP del socket. */
  get ip(): string {
    return SOCKET_IP
  }
}

describe('proxyOriginResolver (el secreto ya configurado)', () => {
  const resolve = proxyOriginResolver(SECRET)

  /** Pedido con el secreto correcto y lo que venga en `claims`. */
  function trusted(claims: Partial<ProxyClaims>): ReturnType<typeof resolve> {
    return resolve({ ...NOTHING, secret: SECRET, ...claims })
  }

  it('con el secreto y una IPv4 válida en x-galpon-client-ip, esa es la IP del cliente', () => {
    expect(trusted({ clientIp: '203.0.113.7' })).toEqual({ kind: 'client', ip: '203.0.113.7' })
    expect(trusted({ clientIp: ' 203.0.113.7 ' })).toEqual({ kind: 'client', ip: '203.0.113.7' })
  })

  it('acepta una IPv6 (también una IPv4 mapeada)', () => {
    expect(trusted({ clientIp: '2001:db8:1:2::9' })).toEqual({
      kind: 'client',
      ip: '2001:db8:1:2::9',
    })
    expect(trusted({ clientIp: '::ffff:203.0.113.7' })).toEqual({
      kind: 'client',
      ip: '::ffff:203.0.113.7',
    })
  })

  it.each(['', 'no-es-una-ip', '999.1.1.1', '203.0.113.7, 198.51.100.1', 'fe80::1%eth0'])(
    'con el secreto y %j en x-galpon-client-ip no hay cliente: origen de confianza',
    (clientIp) => {
      expect(trusted({ clientIp })).toEqual({ kind: 'trusted' })
    },
  )

  it('con el secreto y sin cliente es el servidor de la tienda: origen de confianza', () => {
    expect(trusted({})).toEqual({ kind: 'trusted' })
    // Sin `-from`, X-Forwarded-For no cuenta.
    expect(trusted({ forwardedFor: '203.0.113.7' })).toEqual({ kind: 'trusted' })
  })

  it('con x-galpon-client-ip-from: x-forwarded-for toma la primera IP de X-Forwarded-For', () => {
    const from = { clientIpFrom: CLIENT_IP_FROM_FORWARDED_FOR }

    expect(trusted({ ...from, forwardedFor: '203.0.113.9' })).toEqual({
      kind: 'client',
      ip: '203.0.113.9',
    })
    expect(trusted({ ...from, forwardedFor: ' 203.0.113.9 , 10.0.0.1,10.0.0.2' })).toEqual({
      kind: 'client',
      ip: '203.0.113.9',
    })
    expect(trusted({ ...from, forwardedFor: '2001:db8::7, 10.0.0.1' })).toEqual({
      kind: 'client',
      ip: '2001:db8::7',
    })
  })

  it('con -from: x-forwarded-for se ignora x-galpon-client-ip (lo puede haber escrito el visitante)', () => {
    const spoofed = { clientIpFrom: CLIENT_IP_FROM_FORWARDED_FOR, clientIp: '192.0.2.66' }

    expect(trusted({ ...spoofed, forwardedFor: '203.0.113.9, 10.0.0.1' })).toEqual({
      kind: 'client',
      ip: '203.0.113.9',
    })
    // Sin una primera IP válida no hay cliente: nunca se vuelve a x-galpon-client-ip.
    expect(trusted(spoofed)).toEqual({ kind: 'trusted' })
    expect(trusted({ ...spoofed, forwardedFor: '' })).toEqual({ kind: 'trusted' })
    expect(trusted({ ...spoofed, forwardedFor: 'desconocida, 203.0.113.9' })).toEqual({
      kind: 'trusted',
    })
    expect(trusted({ ...spoofed, forwardedFor: ', 203.0.113.9' })).toEqual({ kind: 'trusted' })
  })

  it.each(['X-Forwarded-For', 'x-real-ip', '', ' x-forwarded-for'])(
    'con -from: %j (cualquier otro valor) vale x-galpon-client-ip y no X-Forwarded-For',
    (clientIpFrom) => {
      expect(
        trusted({ clientIpFrom, clientIp: '203.0.113.7', forwardedFor: '192.0.2.66' }),
      ).toEqual({ kind: 'client', ip: '203.0.113.7' })
      expect(trusted({ clientIpFrom, forwardedFor: '192.0.2.66' })).toEqual({ kind: 'trusted' })
    },
  )

  it.each([
    ['falta', undefined],
    ['está vacío', ''],
    ['es otro del mismo largo', `${SECRET.slice(0, -1)}7`],
    ['es más corto', SECRET.slice(0, -1)],
    ['es más largo', `${SECRET}6`],
    ['cambia las mayúsculas', SECRET.toUpperCase()],
  ])('si el secreto %s el pedido es directo, diga lo que diga', (_case, secret) => {
    const claims = {
      secret,
      clientIp: '203.0.113.7',
      clientIpFrom: CLIENT_IP_FROM_FORWARDED_FOR,
      forwardedFor: '203.0.113.9',
    }

    expect(resolve(claims)).toEqual({ kind: 'direct' })
    expect(resolve({ ...NOTHING, secret })).toEqual({ kind: 'direct' })
  })
})

describe('trustedProxyMiddleware', () => {
  /** Las tres cabeceras, como las mandaría alguien que quiere hacerse pasar por la tienda. */
  function proxyHeaders(secret: string, more: Record<string, string> = {}): Record<string, string> {
    return {
      [PROXY_SECRET_HEADER]: secret,
      [CLIENT_IP_HEADER]: '203.0.113.7',
      'x-forwarded-for': '198.51.100.4',
      'user-agent': 'vitest',
      ...more,
    }
  }

  /** Pasa un pedido con esas cabeceras por el middleware. */
  function handled(
    secret: string | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): { req: FakeRequest; next: ReturnType<typeof vi.fn> } {
    const req = new FakeRequest({ ...headers })
    const next = vi.fn()
    trustedProxyMiddleware({ secret })(req, undefined, next)
    return { req, next }
  }

  it('los nombres de las cabeceras son los que manda la tienda', () => {
    expect([PROXY_SECRET_HEADER, CLIENT_IP_HEADER, CLIENT_IP_FROM_HEADER]).toEqual([
      'x-galpon-proxy-secret',
      'x-galpon-client-ip',
      'x-galpon-client-ip-from',
    ])
    expect(CLIENT_IP_FROM_FORWARDED_FOR).toBe('x-forwarded-for')
  })

  it.each([
    ['sin TRUSTED_PROXY_SECRET', undefined, SECRET],
    ['con el secreto equivocado', SECRET, 'otro-secreto-que-no-es-el-de-la-tienda-99'],
    ['con el secreto correcto', SECRET, SECRET],
  ])('%s borra las tres cabeceras y deja las demás', (_case, configured, sent) => {
    const { req, next } = handled(
      configured,
      proxyHeaders(sent, { [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR }),
    )

    expect(req.headers).toEqual({ 'x-forwarded-for': '198.51.100.4', 'user-agent': 'vitest' })
    expect(next).toHaveBeenCalledExactlyOnceWith()
  })

  it('sin TRUSTED_PROXY_SECRET no decide nada: req.ip queda como estaba', () => {
    for (const configured of [undefined, '']) {
      const { req } = handled(configured, proxyHeaders(SECRET))

      expect(proxyOriginOf(req)).toBeUndefined()
      expect(req.ip).toBe(SOCKET_IP)
    }
    // Una cabecera vacía no vale como secreto de un back sin secreto.
    expect(proxyOriginOf(handled('', proxyHeaders('')).req)).toBeUndefined()
  })

  it('con el secreto correcto y la IP del cliente, req.ip pasa a ser esa IP', () => {
    const { req } = handled(SECRET, proxyHeaders(SECRET))

    expect(proxyOriginOf(req)).toEqual({ kind: 'client', ip: '203.0.113.7' })
    expect(req.ip).toBe('203.0.113.7')
  })

  it('con -from: x-forwarded-for, req.ip es la primera IP de X-Forwarded-For y no la de x-galpon-client-ip', () => {
    const { req } = handled(
      SECRET,
      proxyHeaders(SECRET, {
        [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
        'x-forwarded-for': '198.51.100.4, 10.0.0.1',
      }),
    )

    expect(proxyOriginOf(req)).toEqual({ kind: 'client', ip: '198.51.100.4' })
    expect(req.ip).toBe('198.51.100.4')
  })

  it('con el secreto correcto y sin cliente es un origen de confianza: req.ip sigue siendo la del socket', () => {
    const { req } = handled(SECRET, { [PROXY_SECRET_HEADER]: SECRET })

    expect(proxyOriginOf(req)).toEqual({ kind: 'trusted' })
    expect(req.ip).toBe(SOCKET_IP)
  })

  it('con el secreto equivocado (o sin él) el pedido es directo: req.ip sigue siendo la del socket', () => {
    const wrong = handled(SECRET, proxyHeaders(`${SECRET.slice(0, -1)}7`)).req
    const missing = handled(SECRET, { [CLIENT_IP_HEADER]: '203.0.113.7' }).req

    expect(proxyOriginOf(wrong)).toEqual({ kind: 'direct' })
    expect(wrong.ip).toBe(SOCKET_IP)
    expect(proxyOriginOf(missing)).toEqual({ kind: 'direct' })
    expect(missing.ip).toBe(SOCKET_IP)
  })

  it('una cabecera repetida (lista) no vale: se borra y se trata como si faltara', () => {
    const { req } = handled(SECRET, {
      [PROXY_SECRET_HEADER]: [SECRET, SECRET],
      [CLIENT_IP_HEADER]: '203.0.113.7',
    })

    expect(proxyOriginOf(req)).toEqual({ kind: 'direct' })
    expect(req.headers).toEqual({})
  })
})

describe('trustedProxyMiddleware con TRUSTED_CLIENT_IP_HEADER', () => {
  /** Pasa un pedido por el middleware con la cabecera de borde `true-client-ip`. */
  function handledAtEdge(
    secret: string | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): FakeRequest {
    const req = new FakeRequest({ ...headers })
    trustedProxyMiddleware({ secret, clientIpHeader: 'true-client-ip' })(req, undefined, vi.fn())
    return req
  }

  it('un pedido sin el secreto es del visitante de la cabecera de borde', () => {
    for (const secret of [SECRET, undefined]) {
      const req = handledAtEdge(secret, { 'true-client-ip': ' 198.51.100.23 ' })

      expect(proxyOriginOf(req)).toEqual({ kind: 'client', ip: '198.51.100.23' })
      expect(req.ip).toBe('198.51.100.23')
    }
  })

  it('con el secreto correcto manda lo de la tienda: con cliente o sin él', () => {
    const visitor = handledAtEdge(SECRET, {
      [PROXY_SECRET_HEADER]: SECRET,
      [CLIENT_IP_HEADER]: '203.0.113.7',
      'true-client-ip': '10.20.30.40',
    })
    const store = handledAtEdge(SECRET, {
      [PROXY_SECRET_HEADER]: SECRET,
      'true-client-ip': '10.20.30.40',
    })

    expect(proxyOriginOf(visitor)).toEqual({ kind: 'client', ip: '203.0.113.7' })
    expect(proxyOriginOf(store)).toEqual({ kind: 'trusted' })
    expect(store.ip).toBe(SOCKET_IP)
  })

  it('sin una IP válida en la cabecera de borde queda como sin ella', () => {
    for (const value of [undefined, '', 'no-es-una-ip', '198.51.100.23, 192.0.2.66', ['1.2.3.4']]) {
      expect(proxyOriginOf(handledAtEdge(SECRET, { 'true-client-ip': value }))).toEqual({
        kind: 'direct',
      })
      expect(proxyOriginOf(handledAtEdge(undefined, { 'true-client-ip': value }))).toBeUndefined()
    }
  })
})
