import { createHash } from 'node:crypto'

import type { SecretsPort } from '../../src/shared/application/ports/secrets.port'
import {
  assertNewSession,
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
 * `RedisSessionStore`: TTL por tipo, vencimiento fijo según el reloj inyectado y cierre de todas
 * las sesiones de un usuario. Con `failWith`, cada operación rechaza con ese error (Redis caído).
 */
export class InMemorySessionStore implements SessionPort {
  /** Sesiones guardadas por id (los tests pueden mirarlas o sembrarlas). */
  readonly sessions = new Map<string, SessionRecord>()

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
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      }
      this.sessions.set(session.id, session)
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
  destroyAllForUser(userId: string): Promise<void> {
    return this.run(() => {
      for (const [id, session] of this.sessions) {
        if (session.userId === userId) this.sessions.delete(id)
      }
    })
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
