import { isIPv4, isIPv6 } from 'node:net'

import { proxyOriginOf } from './trusted-proxy'

/** La parte de la app de Express que se usa para `trust proxy`. */
export interface TrustProxyApp {
  /** `app.set` de Express. */
  set(setting: string, value: unknown): unknown
}

/** La parte del pedido de Express que dice quién lo mandó. */
export interface ClientIpRequest {
  /**
   * `req.ip`: la del visitante si la autenticó el secreto compartido (`trustedProxyMiddleware`);
   * si no, con `trust proxy`, la del cliente según `X-Forwarded-For`, y sin él, la del socket.
   */
  ip?: string | undefined
  /** La app de Express del pedido (`req.app`), para leer `trust proxy`. */
  app: { get(setting: string): unknown }
}

/** Función que Express arma con `trust proxy` (`app.get('trust proxy fn')`). */
type TrustFn = (address: string, hop: number) => boolean

function isTrustFn(value: unknown): value is TrustFn {
  return typeof value === 'function'
}

/** Indica si `trust proxy` tiene algo configurado (`false` o una lista vacía = apagado). */
function isTrustProxyOn(setting: unknown): boolean {
  return Array.isArray(setting) ? setting.length > 0 : setting !== undefined && setting !== false
}

/**
 * Configura `trust proxy` de Express con los proxies de `TRUST_PROXY` (NV-25). Con la lista
 * vacía no toca nada: `req.ip` sigue siendo la IP del socket.
 *
 * @param app - La app de Express (`app.getHttpAdapter().getInstance()` o la de Nest con Express).
 * @param trustProxy - IPs, redes CIDR o nombres de red de Express (ya validados por `parseEnv`).
 */
export function applyTrustProxy(app: TrustProxyApp, trustProxy: readonly string[]): void {
  if (trustProxy.length > 0) app.set('trust proxy', [...trustProxy])
}

/**
 * IP real del cliente, cuando se puede saber. Hay dos mecanismos independientes:
 *
 * - Con `TRUSTED_PROXY_SECRET` o `TRUSTED_CLIENT_IP_HEADER` (el pedido pasó por
 *   `trustedProxyMiddleware`), manda el origen que resolvió: la IP del visitante que reenvió la
 *   tienda o el dashboard, o la que escribió el borde de la plataforma (el dashboard llamando
 *   directo desde el navegador); `null` si el pedido lo originó uno de nuestros proyectos sin
 *   visitante (el servidor de la tienda armando sus páginas); y `req.ip` si llegó directo, sin el
 *   secreto ni una IP de borde válida: esos se cuentan por la IP con la que llegan.
 * - Sin ese secreto, `TRUST_PROXY`: `req.ip` si `trust proxy` está configurado y esa IP no es la de
 *   un proxy de confianza. Devuelve `null` sin `TRUST_PROXY` (todo lo que pasa por la tienda llega
 *   con la IP de su servidor) y cuando el pedido lo originó un proxy de confianza: el servidor de
 *   la tienda leyendo para armar sus páginas, o un pedido que la tienda reenvió sin
 *   `X-Forwarded-For`.
 *
 * @param req - Pedido de Express.
 * @returns La IP del cliente, o `null` si no se conoce.
 */
export function knownClientIp(req: ClientIpRequest): string | null {
  const origin = proxyOriginOf(req)
  if (origin?.kind === 'client') return origin.ip
  if (origin?.kind === 'trusted') return null
  const ip = req.ip
  if (ip === undefined || ip === '') return null
  if (origin?.kind === 'direct') return ip
  const trust = req.app.get('trust proxy fn')
  if (!isTrustProxyOn(req.app.get('trust proxy')) || !isTrustFn(trust)) return null
  return trust(ip, 0) ? null : ip
}

/** Grupos de 16 bits de una IPv6. */
const IPV6_GROUPS = 8

/** Grupos de la red /64 de una IPv6. */
const NETWORK_GROUPS = 4

/**
 * Cliente con el que se cuentan los intentos (NV-09): una IPv4 queda igual; una IPv4 mapeada en
 * IPv6 (`::ffff:203.0.113.7`, también en hexadecimal) cuenta como esa IPv4; una IPv6 cuenta como su
 * red /64 (`2001:db8:1:2::/64`), porque quien tiene una IPv6 suele tener la /64 entera y podría
 * estrenar una dirección en cada intento. La zona (`%eth0`) se ignora. Lo que no es una IP queda
 * igual (recortado).
 *
 * @param ip - IP del cliente (`req.ip`).
 * @returns La IPv4, la red /64 o el texto recortado.
 * @example
 * clientNetworkOf('::ffff:203.0.113.7') // '203.0.113.7'
 * clientNetworkOf('2001:db8:1:2:aaaa::1') // '2001:db8:1:2::/64'
 */
export function clientNetworkOf(ip: string): string {
  const address = ip.trim()
  if (isIPv4(address)) return address
  const [withoutZone = ''] = address.split('%')
  if (!isIPv6(withoutZone)) return address
  const groups = ipv6Groups(withoutZone)
  const mapped = mappedIPv4Of(groups)
  if (mapped !== null) return mapped
  const network = groups.slice(0, NETWORK_GROUPS).map((group) => group.toString(16))
  return `${network.join(':')}::/64`
}

/**
 * Los 8 grupos de una IPv6 ya validada (`isIPv6`): expande `::` y pasa a dos grupos la IPv4 del
 * final (`::ffff:1.2.3.4`).
 */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase()
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number)
    const high = ((a << 8) | b).toString(16)
    const low = ((c << 8) | d).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }
  const parse = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((group) => parseInt(group, 16))
  const [head, rest] = text.split('::')
  const left = parse(head)
  if (rest === undefined) return left
  const right = parse(rest)
  const zeros = Array<number>(IPV6_GROUPS - left.length - right.length).fill(0)
  return [...left, ...zeros, ...right]
}

/** La IPv4 de una IPv6 mapeada (`::ffff:a.b.c.d`: 80 bits en 0 y 16 en 1), o `null`. */
function mappedIPv4Of(groups: readonly number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups
  if (g0 !== 0 || g1 !== 0 || g2 !== 0 || g3 !== 0 || g4 !== 0 || g5 !== 0xffff) return null
  return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.')
}
