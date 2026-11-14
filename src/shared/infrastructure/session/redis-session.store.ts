import { Logger } from '@nestjs/common'

import type { SecretsPort } from '../../application/ports/secrets.port'
import {
  assertNewSession,
  type DestroyAllForUserOptions,
  MAX_SESSIONS_PER_USER,
  type NewSession,
  type SessionKind,
  type SessionPort,
  type SessionRecord,
  SESSION_TTL_SECONDS,
} from '../../application/ports/session.port'
import type { Clock } from '../../domain/clock'
import { DomainError } from '../../domain/domain-error'
import { createRateLimitedWarn, errorMessage, type WarnLogger } from '../redis/rate-limited-warn'

/** Bytes aleatorios de los ids de sesión y de los tokens CSRF (64 caracteres hex). */
const TOKEN_BYTES = 32

/** Forma de un id de sesión: lo que no la cumple ni se busca en Redis. */
const SESSION_ID_PATTERN = /^[0-9a-f]{64}$/

/** Vida del índice de sesiones de un usuario: la de la sesión más larga (cliente, 30 días). */
const USER_SESSIONS_TTL_SECONDS = SESSION_TTL_SECONDS.customer

/**
 * Vida de la marca de credenciales de un usuario: la de la sesión más larga. Pasado ese tiempo,
 * toda sesión autenticada antes de la marca ya venció sola.
 */
const CREDENTIALS_MARKER_TTL_SECONDS = SESSION_TTL_SECONDS.customer

/** Sesiones que se borran por transacción en la limpieza (nunca un `DEL` con miles de claves). */
const CLEANUP_BATCH_SIZE = 100

const SESSION_KINDS: ReadonlySet<string> = new Set(Object.keys(SESSION_TTL_SECONDS))

/** `detail` del 503 cuando el almacén de sesiones no responde. */
export const SESSION_UNAVAILABLE_DETAIL =
  'No pudimos verificar tu sesión. Probá de nuevo en un momento.'

/** Comandos encolados en una transacción `MULTI` de ioredis (se mandan juntos en `exec`). */
export interface RedisSessionTransaction {
  /** `SET key value EX seconds`. */
  set(key: string, value: string, secondsToken: 'EX', seconds: number): RedisSessionTransaction
  /** `SADD key member`. */
  sadd(key: string, member: string): RedisSessionTransaction
  /** `SREM key member [member ...]`. */
  srem(key: string, ...members: string[]): RedisSessionTransaction
  /** `EXPIRE key seconds`. */
  expire(key: string, seconds: number): RedisSessionTransaction
  /** `DEL key [key ...]`. */
  del(...keys: string[]): RedisSessionTransaction
  /** `EXEC`: un `[error, resultado]` por comando, o `null` si se abortó. */
  exec(): Promise<[error: Error | null, result: unknown][] | null>
}

/** Lo que usa el almacén de sesiones de ioredis (un `Redis` de ioredis lo cumple). */
export interface RedisSessionClient {
  /** `GET key`: el texto guardado o `null`. */
  get(key: string): Promise<string | null>
  /** `SMEMBERS key`. */
  smembers(key: string): Promise<string[]>
  /** `MGET key [key ...]`: el texto de cada clave, o `null` si no está. */
  mget(...keys: string[]): Promise<(string | null)[]>
  /** Abre una transacción `MULTI`. */
  multi(): RedisSessionTransaction
}

/**
 * {@link SessionPort} sobre Redis. Cada sesión es `session:{id}` (JSON con `EX` = la duración de
 * su tipo, vencimiento fijo) y las de un usuario se indexan en el set `user-sessions:{userId}`
 * (con `EXPIRE` de 30 días), con un tope de {@link MAX_SESSIONS_PER_USER} vigentes: al pasarlo se
 * cierra la más vieja. Ids y tokens CSRF: 32 bytes aleatorios.
 *
 * Cerrar todas las sesiones de un usuario escribe primero su marca de credenciales
 * (`user-credentials:{userId}`, la hora del cambio en milisegundos): `get` rechaza toda sesión del
 * usuario autenticada hasta esa hora, aunque se haya creado después. El borrado de las sesiones
 * viejas es de mejor esfuerzo.
 *
 * **Falla cerrado:** cualquier error de Redis termina en un `DomainError` 503
 * `service_unavailable` (avisado por `warn` como mucho una vez por minuto), nunca en "sin
 * sesión" ni en "sesión válida".
 */
export class RedisSessionStore implements SessionPort {
  private readonly warn: (message: string) => void

  /**
   * @param redis - Cliente de Redis (el de `RedisService`).
   * @param secrets - Generador de ids y tokens.
   * @param clock - Reloj para `createdAt`/`expiresAt`.
   * @param logger - Destino de los avisos (por defecto, el `Logger` de Nest).
   */
  constructor(
    private readonly redis: RedisSessionClient,
    private readonly secrets: SecretsPort,
    private readonly clock: Clock,
    logger: WarnLogger = new Logger(RedisSessionStore.name),
  ) {
    this.warn = createRateLimitedWarn(logger)
  }

  /**
   * {@inheritDoc SessionPort.create}
   *
   * @throws {TypeError} En español, si los datos no son coherentes con el tipo de sesión.
   * @throws {DomainError} 503 `service_unavailable` si Redis no responde.
   */
  async create(input: NewSession): Promise<SessionRecord> {
    assertNewSession(input)
    const ttlSeconds = SESSION_TTL_SECONDS[input.kind]
    const now = this.clock.now()
    const session: SessionRecord = {
      id: this.secrets.token(TOKEN_BYTES),
      kind: input.kind,
      userId: input.userId,
      customerId: input.customerId,
      csrfToken: this.secrets.token(TOKEN_BYTES),
      createdAt: now.toISOString(),
      authenticatedAt: (input.authenticatedAt ?? now).toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    }
    const { userId } = session
    await this.run(async () => {
      const transaction = this.redis
        .multi()
        .set(sessionKey(session.id), JSON.stringify(session), 'EX', ttlSeconds)
      if (userId !== null) {
        const index = userSessionsKey(userId)
        transaction.sadd(index, session.id).expire(index, USER_SESSIONS_TTL_SECONDS)
      }
      await execOrThrow(transaction)
      if (userId !== null) await this.enforceSessionCap(userId, session.id)
    })
    return session
  }

  /**
   * {@inheritDoc SessionPort.get}
   *
   * @throws {DomainError} 503 `service_unavailable` si Redis no responde.
   */
  async get(id: string): Promise<SessionRecord | null> {
    const session = await this.read(id)
    if (session === null) return null
    if (Date.parse(session.expiresAt) <= this.clock.now().getTime()) return null
    const { userId } = session
    if (userId === null) return session
    const changedAt = await this.run(() => this.redis.get(credentialsKey(userId)))
    return isRevoked(session, changedAt) ? null : session
  }

  /**
   * {@inheritDoc SessionPort.destroy}
   *
   * @throws {DomainError} 503 `service_unavailable` si Redis no responde.
   */
  async destroy(id: string): Promise<void> {
    const session = await this.read(id)
    if (session === null) return
    await this.run(async () => {
      const transaction = this.redis.multi().del(sessionKey(id))
      if (session.userId !== null) transaction.srem(userSessionsKey(session.userId), id)
      await execOrThrow(transaction)
    })
  }

  /**
   * {@inheritDoc SessionPort.destroyAllForUser}
   *
   * @throws {TypeError} En español, si `userId` está vacío.
   * @throws {DomainError} 503 `service_unavailable` si Redis no responde.
   */
  async destroyAllForUser(userId: string, options: DestroyAllForUserOptions = {}): Promise<void> {
    if (userId.trim() === '') throw new TypeError('Falta el usuario cuyas sesiones se cierran')
    const changedAt = this.clock.now().getTime()
    const kept = options.keep === undefined ? null : await this.read(options.keep)
    const keepId = kept !== null && kept.userId === userId ? kept.id : null
    const transaction = this.redis
      .multi()
      .set(credentialsKey(userId), String(changedAt), 'EX', CREDENTIALS_MARKER_TTL_SECONDS)
    if (kept !== null && keepId !== null) {
      // Renovada en la misma transacción que la marca: nunca hay un momento en que no valga.
      const remainingSeconds = Math.ceil((Date.parse(kept.expiresAt) - changedAt) / 1000)
      const renewed: SessionRecord = {
        ...kept,
        authenticatedAt: new Date(changedAt + 1).toISOString(),
      }
      if (remainingSeconds > 0) {
        transaction.set(sessionKey(keepId), JSON.stringify(renewed), 'EX', remainingSeconds)
      }
    }
    await this.run(() => execOrThrow(transaction))
    await this.removeSessionsOf(userId, keepId)
  }

  /**
   * Limpieza de mejor esfuerzo después de la marca de credenciales: borra las sesiones del índice
   * del usuario (salvo `keepId`) de a {@link CLEANUP_BATCH_SIZE}. Si Redis falla, solo avisa: esas
   * sesiones ya no valen y vencen solas.
   */
  private async removeSessionsOf(userId: string, keepId: string | null): Promise<void> {
    const index = userSessionsKey(userId)
    try {
      const ids = (await this.redis.smembers(index)).filter((id) => id !== keepId)
      for (let start = 0; start < ids.length; start += CLEANUP_BATCH_SIZE) {
        const batch = ids.slice(start, start + CLEANUP_BATCH_SIZE)
        await execOrThrow(
          this.redis
            .multi()
            .del(...batch.map(sessionKey))
            .srem(index, ...batch),
        )
      }
    } catch (error) {
      this.warn(`No se pudieron borrar sesiones viejas (igual ya no valen): ${errorMessage(error)}`)
    }
  }

  /**
   * Deja al usuario con {@link MAX_SESSIONS_PER_USER} sesiones vigentes como mucho: saca del índice
   * las que ya no están y, si sobran, cierra las más viejas (nunca `createdId`, la recién abierta).
   */
  private async enforceSessionCap(userId: string, createdId: string): Promise<void> {
    const index = userSessionsKey(userId)
    const ids = await this.redis.smembers(index)
    if (ids.length <= MAX_SESSIONS_PER_USER) return
    const raws = await this.redis.mget(...ids.map(sessionKey))
    const now = this.clock.now().getTime()
    const gone: string[] = []
    const alive: SessionRecord[] = []
    ids.forEach((id, position) => {
      const raw = raws[position] ?? null
      const session = raw === null ? null : parseSession(raw, id)
      if (session === null || Date.parse(session.expiresAt) <= now) gone.push(id)
      else alive.push(session)
    })
    alive.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
    )
    const evicted = alive
      .filter((session) => session.id !== createdId)
      .slice(0, Math.max(0, alive.length - MAX_SESSIONS_PER_USER))
      .map((session) => session.id)
    const removed = [...gone, ...evicted]
    if (removed.length === 0) return
    await execOrThrow(
      this.redis
        .multi()
        .del(...removed.map(sessionKey))
        .srem(index, ...removed),
    )
  }

  /** Lee y valida `session:{id}` sin mirar el vencimiento; `null` si no está o es ilegible. */
  private async read(id: string): Promise<SessionRecord | null> {
    if (!SESSION_ID_PATTERN.test(id)) return null
    const raw = await this.run(() => this.redis.get(sessionKey(id)))
    return raw === null ? null : parseSession(raw, id)
  }

  /** Corre comandos de Redis: si fallan, avisa y lanza el 503 (falla cerrado). */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      this.warn(`Sesiones sin Redis (se responde 503): ${errorMessage(error)}`)
      throw new DomainError('service_unavailable', 503, SESSION_UNAVAILABLE_DETAIL)
    }
  }
}

function sessionKey(id: string): string {
  return `session:${id}`
}

function userSessionsKey(userId: string): string {
  return `user-sessions:${userId}`
}

function credentialsKey(userId: string): string {
  return `user-credentials:${userId}`
}

/**
 * Indica si una sesión quedó cerrada por un cambio de contraseña: su credencial se comprobó no
 * después de la marca del usuario. Una marca ilegible cuenta como un cambio (falla cerrado).
 */
function isRevoked(session: SessionRecord, changedAt: string | null): boolean {
  if (changedAt === null) return false
  const marker = Number(changedAt)
  return !Number.isFinite(marker) || Date.parse(session.authenticatedAt) <= marker
}

/** Manda la transacción y lanza si se abortó o si algún comando falló. */
async function execOrThrow(transaction: RedisSessionTransaction): Promise<void> {
  const results = await transaction.exec()
  if (results === null) throw new Error('La transacción de Redis se abortó')
  const failed = results.find(([error]) => error !== null)
  if (failed?.[0]) throw failed[0]
}

/** Valida el JSON guardado; cualquier cosa que no sea una sesión de este id cuenta como ausente. */
function parseSession(raw: string, id: string): SessionRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const { kind, userId, customerId, csrfToken, createdAt, expiresAt } = record
  // Las sesiones guardadas antes de la marca de credenciales no tienen el campo: vale la creación.
  const authenticatedAt = record.authenticatedAt ?? createdAt
  if (
    record.id !== id ||
    typeof kind !== 'string' ||
    !SESSION_KINDS.has(kind) ||
    !isNullableString(userId) ||
    !isNullableString(customerId) ||
    typeof csrfToken !== 'string' ||
    csrfToken === '' ||
    typeof createdAt !== 'string' ||
    typeof authenticatedAt !== 'string' ||
    Number.isNaN(Date.parse(authenticatedAt)) ||
    typeof expiresAt !== 'string' ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    return null
  }
  return {
    id,
    kind: kind as SessionKind,
    userId,
    customerId,
    csrfToken,
    createdAt,
    authenticatedAt,
    expiresAt,
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
