import { createHash } from 'node:crypto'

import type { SecretsPort } from '../../src/shared/application/ports/secrets.port'
import {
  assertNewSession,
  type DestroyAllForUserOptions,
  MAX_SESSIONS_PER_USER,
  type NewSession,
  type SessionPort,
  type SessionRecord,
  SESSION_TTL_SECONDS,
} from '../../src/shared/application/ports/session.port'
import { type Clock, SystemClock } from '../../src/shared/domain/clock'

/**
 * {@link SecretsPort} predecible para los tests: cada `token(bytes)` es un contador en hex
 * rellenado con ceros hasta `bytes * 2` caracteres (`000…001`, `000…002`, …). `sha256` es el
 * SHA-256 real, para poder comparar con lo que se guarda.
 */
export class FixedSecrets implements SecretsPort {
  private counter = 0

  /** {@inheritDoc SecretsPort.token} */
  token(bytes: number): string {
    if (!Number.isInteger(bytes) || bytes < 1) {
      throw new RangeError(
        `La cantidad de bytes tiene que ser un entero mayor que 0 (llegó ${String(bytes)})`,
      )
    }
    this.counter += 1
    return this.counter.toString(16).padStart(bytes * 2, '0')
  }

  /** {@inheritDoc SecretsPort.sha256} */
  sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}

/**
 * {@link SessionPort} en memoria para los tests (sin Redis), con las mismas reglas que
 * `RedisSessionStore`: TTL por tipo, vencimiento fijo según el reloj inyectado, tope de sesiones
 * por usuario (se cierra la más vieja) y cierre de todas las sesiones de un usuario con su marca de
 * credenciales (rechaza también las autenticadas antes que se creen después). Con `failWith`, cada
 * operación rechaza con ese error (Redis caído).
 */
export class InMemorySessionStore implements SessionPort {
  /** Sesiones guardadas por id, en orden de alta (los tests pueden mirarlas o sembrarlas). */
  readonly sessions = new Map<string, SessionRecord>()

  /** Marca de credenciales por usuario: la hora (ms) del último cierre de todas sus sesiones. */
  readonly credentialsChangedAt = new Map<string, number>()

  /**
   * @param clock - Reloj para `createdAt`/`expiresAt` y para decidir el vencimiento.
   * @param secrets - Generador de ids y tokens CSRF.
   * @param failWith - Si se define, cada operación rechaza con lo que devuelve (Redis caído).
   */
  constructor(
    private readonly clock: Clock = new SystemClock(),
    private readonly secrets: SecretsPort = new FixedSecrets(),
    public failWith?: (() => Error) | undefined,
  ) {}

  /** {@inheritDoc SessionPort.create} */
  create(input: NewSession): Promise<SessionRecord> {
    return this.run(() => {
      assertNewSession(input)
      const now = this.clock.now()
      const ttlMs = SESSION_TTL_SECONDS[input.kind] * 1000
      const session: SessionRecord = {
        id: this.secrets.token(32),
        kind: input.kind,
        userId: input.userId,
        customerId: input.customerId,
        csrfToken: this.secrets.token(32),
        createdAt: now.toISOString(),
        authenticatedAt: (input.authenticatedAt ?? now).toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      }
      this.sessions.set(session.id, session)
      if (session.userId !== null) this.enforceCap(session.userId)
      return { ...session }
    })
  }

  /** {@inheritDoc SessionPort.get} */
  get(id: string): Promise<SessionRecord | null> {
    return this.run(() => {
      const session = this.sessions.get(id)
      if (session === undefined) return null
      if (Date.parse(session.expiresAt) <= this.clock.now().getTime()) {
        this.sessions.delete(id)
        return null
      }
      const changedAt =
        session.userId === null ? undefined : this.credentialsChangedAt.get(session.userId)
      if (changedAt !== undefined && Date.parse(session.authenticatedAt) <= changedAt) return null
      return { ...session }
    })
  }

  /** {@inheritDoc SessionPort.destroy} */
  destroy(id: string): Promise<void> {
    return this.run(() => {
      this.sessions.delete(id)
    })
  }

  /** {@inheritDoc SessionPort.destroyAllForUser} */
  destroyAllForUser(userId: string, options: DestroyAllForUserOptions = {}): Promise<void> {
    return this.run(() => {
      const changedAt = this.clock.now().getTime()
      this.credentialsChangedAt.set(userId, changedAt)
      for (const [id, session] of this.sessions) {
        if (session.userId !== userId) continue
        if (id === options.keep) {
          const authenticatedAt = new Date(changedAt + 1).toISOString()
          this.sessions.set(id, { ...session, authenticatedAt })
        } else {
          this.sessions.delete(id)
        }
      }
    })
  }

  /** Deja al usuario con el tope de sesiones: cierra las más viejas (orden de alta). */
  private enforceCap(userId: string): void {
    const own = [...this.sessions.values()].filter((session) => session.userId === userId)
    for (const session of own.slice(0, Math.max(0, own.length - MAX_SESSIONS_PER_USER))) {
      this.sessions.delete(session.id)
    }
  }

  /** Corre la operación como promesa; con `failWith`, rechaza (como Redis caído). */
  private run<T>(operation: () => T): Promise<T> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith())
    try {
      return Promise.resolve(operation())
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
