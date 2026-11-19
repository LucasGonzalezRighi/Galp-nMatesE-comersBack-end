import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

/**
 * Cabecera con el secreto compartido (`TRUSTED_PROXY_SECRET`, el `API_PROXY_SECRET` de la tienda):
 * la mandan solo nuestros proyectos (la tienda, y el dashboard por el reenvío de Vercel) y prueba
 * que el pedido viene de ellos.
 */
export const PROXY_SECRET_HEADER = 'x-galpon-proxy-secret'

/** Cabecera con la IP del visitante, cuando la escribe el servidor de la tienda. */
export const CLIENT_IP_HEADER = 'x-galpon-client-ip'

/**
 * Cabecera que dice de qué otra cabecera sale la IP del visitante. Solo se acepta
 * {@link CLIENT_IP_FROM_FORWARDED_FOR}.
 */
export const CLIENT_IP_FROM_HEADER = 'x-galpon-client-ip-from'

/**
 * Único valor aceptado de {@link CLIENT_IP_FROM_HEADER}: la IP del visitante es la primera de
 * `X-Forwarded-For` (Vercel pisa esa cabecera con la IP del visitante; los saltos de después solo
 * agregan a la derecha).
 */
export const CLIENT_IP_FROM_FORWARDED_FOR = 'x-forwarded-for'

/** Cabecera estándar con la cadena de IPs por las que pasó el pedido. */
const FORWARDED_FOR_HEADER = 'x-forwarded-for'

/**
 * De dónde viene un pedido cuando el back tiene `TRUSTED_PROXY_SECRET` o `TRUSTED_CLIENT_IP_HEADER`:
 *
 * - `client`: lo reenvió uno de nuestros proyectos por un visitante, con su IP (o, con la cabecera
 *   de borde, lo mandó el visitante directo);
 * - `trusted`: lo originó uno de nuestros proyectos (el servidor de la tienda armando sus
 *   páginas), sin visitante;
 * - `direct`: llegó sin el secreto (o con uno equivocado) y sin una IP válida en la cabecera de
 *   borde (`TRUSTED_CLIENT_IP_HEADER`).
 *
 * Con la cabecera de borde, un pedido sin el secreto que la trae es `client` con esa IP.
 */
export type ProxyOrigin =
  | {
      /** Pedido de un visitante, reenviado por la tienda o el dashboard. */
      readonly kind: 'client'
      /** IP del visitante (IPv4 o IPv6, sin zona). */
      readonly ip: string
    }
  | {
      /** Pedido de uno de nuestros proyectos, sin visitante. */
      readonly kind: 'trusted'
    }
  | {
      /** Pedido sin el secreto correcto. */
      readonly kind: 'direct'
    }

/** Lo que un pedido dice de sí mismo: las tres cabeceras propias y `X-Forwarded-For`. */
export interface ProxyClaims {
  /** Valor de {@link PROXY_SECRET_HEADER}. */
  readonly secret: string | undefined
  /** Valor de {@link CLIENT_IP_HEADER}. */
  readonly clientIp: string | undefined
  /** Valor de {@link CLIENT_IP_FROM_HEADER}. */
  readonly clientIpFrom: string | undefined
  /** Valor de `X-Forwarded-For`. */
  readonly forwardedFor: string | undefined
}

/** La parte del pedido de Express que usa {@link trustedProxyMiddleware}. */
export interface ProxyHeadersRequest {
  /** Cabeceras del pedido (`req.headers`), con los nombres en minúsculas. */
  headers: Record<string, string | string[] | undefined>
}

/** Origen de cada pedido que pasó por {@link trustedProxyMiddleware} con el secreto configurado. */
const ORIGINS = new WeakMap<object, ProxyOrigin>()

const TRUSTED_ORIGIN: ProxyOrigin = { kind: 'trusted' }
const DIRECT_ORIGIN: ProxyOrigin = { kind: 'direct' }

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** La IP recortada si es una IPv4 o una IPv6 válida y sin zona (`%eth0`); si no, `null`. */
function validIp(value: string | undefined): string | null {
  const ip = (value ?? '').trim()
  return isIP(ip) !== 0 && !ip.includes('%') ? ip : null
}

/** Origen de un pedido de confianza: con la IP del visitante si es válida, o sin visitante. */
function trustedOrigin(clientIp: string | undefined): ProxyOrigin {
  const ip = validIp(clientIp)
  return ip === null ? TRUSTED_ORIGIN : { kind: 'client', ip }
}

/**
 * Arma la función que decide de dónde viene un pedido según el secreto compartido:
 *
 * 1. Sin la cabecera del secreto, o con una distinta: `direct`, diga lo que diga el resto.
 * 2. Con el secreto y `x-galpon-client-ip-from: x-forwarded-for`: el visitante es la primera IP
 *    de `X-Forwarded-For`, si es válida; si no, `trusted`. En este camino `x-galpon-client-ip` se
 *    ignora siempre: lo usa el proxy estático del dashboard, que no puede garantizar que borra la
 *    que mande el visitante.
 * 3. Con el secreto y sin esa cabecera (o con otro valor): el visitante es la IP de
 *    `x-galpon-client-ip`, si es válida (la escribe el servidor de la tienda, que borra las tres
 *    cabeceras que mande el visitante); si no, `trusted`.
 *
 * El secreto se compara en tiempo constante sobre los SHA-256 de los dos valores, así tampoco se
 * filtra su largo.
 *
 * @param secret - `TRUSTED_PROXY_SECRET`, ya validado por `parseEnv` (32 caracteres o más).
 * @returns La función que resuelve cada pedido.
 * @example
 * const resolve = proxyOriginResolver(env.TRUSTED_PROXY_SECRET)
 * resolve({ secret, clientIp: '203.0.113.7', clientIpFrom: undefined, forwardedFor: undefined })
 * // { kind: 'client', ip: '203.0.113.7' }
 */
export function proxyOriginResolver(secret: string): (claims: ProxyClaims) => ProxyOrigin {
  const expected = sha256(secret)
  return (claims) => {
    if (claims.secret === undefined || !timingSafeEqual(sha256(claims.secret), expected)) {
      return DIRECT_ORIGIN
    }
    if (claims.clientIpFrom === CLIENT_IP_FROM_FORWARDED_FOR) {
      const [leftmost] = (claims.forwardedFor ?? '').split(',')
      return trustedOrigin(leftmost)
    }
    return trustedOrigin(claims.clientIp)
  }
}

/** El valor de una cabecera (una repetida que llega como lista no vale). */
function headerText(headers: ProxyHeadersRequest['headers'], name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Saca una cabecera del pedido y devuelve el valor que tenía. */
function takeHeader(headers: ProxyHeadersRequest['headers'], name: string): string | undefined {
  const value = headerText(headers, name)
  Reflect.deleteProperty(headers, name)
  return value
}

/** Configuración de {@link trustedProxyMiddleware}, ya validada por `parseEnv`. */
export interface TrustedProxyOptions {
  /** `TRUSTED_PROXY_SECRET`; `undefined` (o vacío) si no está configurado. */
  readonly secret: string | undefined
  /**
   * `TRUSTED_CLIENT_IP_HEADER`, en minúsculas: la cabecera donde el borde de la plataforma escribe
   * la IP del visitante pisando lo que mande el navegador (en Render, `true-client-ip`, que pone
   * Cloudflare); `undefined` si no está configurada.
   */
  readonly clientIpHeader?: string | undefined
}

/**
 * Origen de un pedido que no trae el secreto correcto (o de cualquiera, si el back no tiene
 * secreto) cuando hay cabecera de borde: el visitante es la IP de esa cabecera, si es válida. Así
 * el dashboard, que en Render le habla directo al back desde el navegador, se cuenta por la IP de
 * quien lo usa y no por la del proxy de Render.
 */
function edgeOrigin(
  origin: ProxyOrigin | undefined,
  edgeIp: string | undefined,
): ProxyOrigin | undefined {
  if (origin !== undefined && origin.kind !== 'direct') return origin
  const ip = edgeIp === undefined ? null : validIp(edgeIp)
  return ip === null ? origin : { kind: 'client', ip }
}

/**
 * Middleware de Express que resuelve la IP del cliente sin `TRUST_PROXY`, para cuando no hay IPs
 * fijas que listar (la tienda y el dashboard en Render o en Vercel). En cada pedido:
 *
 * 1. Lee {@link PROXY_SECRET_HEADER}, {@link CLIENT_IP_HEADER} y {@link CLIENT_IP_FROM_HEADER} y
 *    las borra de `req.headers`: nunca llegan a los controladores ni a los logs.
 * 2. Con secreto (`TRUSTED_PROXY_SECRET`), resuelve el origen ({@link proxyOriginResolver}): lo que
 *    reenvía la tienda con el secreto manda sobre cualquier otra cabecera.
 * 3. Con cabecera de borde (`TRUSTED_CLIENT_IP_HEADER`), un pedido sin el secreto correcto (el
 *    navegador del dashboard, o quien le pegue directo al back) es de la IP de esa cabecera, si
 *    es válida; si falta o no es una IP, queda como estaba (`direct`, o sin decidir sin secreto).
 * 4. Guarda el origen para {@link proxyOriginOf}. Si hay visitante, `req.ip` pasa a devolver su IP
 *    (una propiedad propia del pedido, que tapa el getter de Express), así el límite por IP cuenta
 *    por esa IP. Sin secreto ni cabecera de borde no hace nada más (todo sigue según `TRUST_PROXY`).
 *
 * @param options - El secreto y la cabecera de borde (cualquiera de los dos puede faltar).
 * @returns El middleware, para `app.use()` después de `applyTrustProxy`.
 */
export function trustedProxyMiddleware(
  options: TrustedProxyOptions,
): (req: ProxyHeadersRequest, res: unknown, next: () => void) => void {
  const { secret, clientIpHeader } = options
  const resolve = secret === undefined || secret === '' ? null : proxyOriginResolver(secret)
  const edgeHeader = clientIpHeader === undefined || clientIpHeader === '' ? null : clientIpHeader
  return (req, _res, next) => {
    const claims: ProxyClaims = {
      secret: takeHeader(req.headers, PROXY_SECRET_HEADER),
      clientIp: takeHeader(req.headers, CLIENT_IP_HEADER),
      clientIpFrom: takeHeader(req.headers, CLIENT_IP_FROM_HEADER),
      forwardedFor: headerText(req.headers, FORWARDED_FOR_HEADER),
    }
    const resolved = resolve === null ? undefined : resolve(claims)
    const origin =
      edgeHeader === null ? resolved : edgeOrigin(resolved, headerText(req.headers, edgeHeader))
    if (origin !== undefined) {
      ORIGINS.set(req, origin)
      if (origin.kind === 'client') {
        Object.defineProperty(req, 'ip', {
          value: origin.ip,
          enumerable: true,
          configurable: true,
        })
      }
    }
    next()
  }
}

/**
 * Origen que {@link trustedProxyMiddleware} resolvió para un pedido.
 *
 * @param req - Pedido de Express.
 * @returns El origen, o `undefined` si el back no tiene `TRUSTED_PROXY_SECRET` ni
 *   `TRUSTED_CLIENT_IP_HEADER` (o, sin secreto, el pedido no trajo una IP válida en esa cabecera,
 *   o no pasó por el middleware).
 */
export function proxyOriginOf(req: object): ProxyOrigin | undefined {
  return ORIGINS.get(req)
}
