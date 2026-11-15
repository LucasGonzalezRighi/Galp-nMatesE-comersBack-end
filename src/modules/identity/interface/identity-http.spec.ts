import { describe, expect, it } from 'vitest'

import { clientIpOf, UNKNOWN_CLIENT_IP } from './identity-http'

describe('clientIpOf: con qué cliente se cuentan los intentos de inicio de sesión (NV-09)', () => {
  it('una IPv4 queda igual', () => {
    expect(clientIpOf('203.0.113.7')).toBe('203.0.113.7')
  })

  it('una IPv4 mapeada en IPv6 cuenta como la misma IPv4 (también en hexadecimal y en mayúsculas)', () => {
    expect(clientIpOf('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(clientIpOf('::FFFF:203.0.113.7')).toBe('203.0.113.7')
    expect(clientIpOf('::ffff:cb00:7107')).toBe('203.0.113.7')
    expect(clientIpOf('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('una IPv6 cuenta por su red /64: las direcciones de la misma red son el mismo cliente', () => {
    const network = '2001:db8:1:2::/64'

    expect(clientIpOf('2001:db8:1:2::1')).toBe(network)
    expect(clientIpOf('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe(network)
    expect(clientIpOf('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(network)
    expect(clientIpOf('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64')
  })

  it('arma la /64 también con :: al principio, con IPv4 al final y con zona', () => {
    expect(clientIpOf('::1')).toBe('0:0:0:0::/64')
    expect(clientIpOf('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64')
    expect(clientIpOf('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(clientIpOf('2001:db8::')).toBe('2001:db8:0:0::/64')
  })

  it('sin IP (o con algo que no es una IP) no queda vacía', () => {
    expect(clientIpOf(undefined)).toBe(UNKNOWN_CLIENT_IP)
    expect(clientIpOf('  ')).toBe(UNKNOWN_CLIENT_IP)
    expect(clientIpOf('no-es-una-ip')).toBe('no-es-una-ip')
  })
})
