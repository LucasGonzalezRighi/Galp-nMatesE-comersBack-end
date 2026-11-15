/** La parte de la app de Express que se usa para `trust proxy`. */
export interface TrustProxyApp {
  /** `app.set` de Express. */
  set(setting: string, value: unknown): unknown
}

/** La parte del pedido de Express que dice quién lo mandó. */
export interface ClientIpRequest {
  /** `req.ip`: con `trust proxy`, la del cliente según `X-Forwarded-For`; sin él, la del socket. */
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
 * IP real del cliente, cuando se puede saber: `req.ip` si `trust proxy` está configurado y esa IP
 * no es la de un proxy de confianza.
 *
 * Devuelve `null` sin `TRUST_PROXY` (todo lo que pasa por la tienda llega con la IP de su
 * servidor) y cuando el pedido lo originó un proxy de confianza: el servidor de la tienda leyendo
 * para armar sus páginas, o un pedido que la tienda reenvió sin `X-Forwarded-For`.
 *
 * @param req - Pedido de Express.
 * @returns La IP del cliente, o `null` si no se conoce.
 */
export function knownClientIp(req: ClientIpRequest): string | null {
  const ip = req.ip
  if (ip === undefined || ip === '') return null
  const trust = req.app.get('trust proxy fn')
  if (!isTrustProxyOn(req.app.get('trust proxy')) || !isTrustFn(trust)) return null
  return trust(ip, 0) ? null : ip
}
