import { Logger } from '@nestjs/common'

import {
  createRateLimitedWarn,
  errorMessage,
  type WarnLogger,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import type { LoginAttemptsPort } from '../application/ports/login-attempts.port'

/** Fallos que bloquean un email dentro de la ventana (Ruling B-7). */
export const LOGIN_FAILURE_LIMIT = 10

/** Largo de la ventana en segundos: 15 minutos desde el primer fallo. */
export const LOGIN_FAILURE_WINDOW_SECONDS = 900

/** Los comandos de ioredis que usa el bloqueo (un `Redis` de ioredis lo cumple). */
export interface LoginAttemptsRedisClient {
  /** `INCR key`: el valor después de sumar. */
  incr(key: string): Promise<number>
  /** `EXPIRE key seconds NX`: pone el vencimiento solo si la clave no tiene uno. */
  expire(key: string, seconds: number, mode: 'NX'): Promise<number>
  /** `TTL key`: segundos que faltan (`-1` sin vencimiento, `-2` si no existe). */
  ttl(key: string): Promise<number>
  /** `GET key`. */
  get(key: string): Promise<string | null>
  /** `DEL key`. */
  del(key: string): Promise<number>
}

/**
 * {@link LoginAttemptsPort} sobre Redis: un contador `login-fail:{email}` que vence a los 15
 * minutos del primer fallo; desde el décimo, el email queda bloqueado por el TTL que le queda.
 *
 * **Falla abierta:** si Redis no responde, nada queda bloqueado, ninguna operación lanza y se
 * avisa por `warn` como mucho una vez por minuto.
 */
export class RedisLoginAttempts implements LoginAttemptsPort {
  private readonly warn: (message: string) => void

  /**
   * @param redis - Cliente de Redis (el de `RedisService`).
   * @param logger - Destino de los avisos (por defecto, el `Logger` de Nest).
   * @param now - Reloj en milisegundos para espaciar los avisos.
   */
  constructor(
    private readonly redis: LoginAttemptsRedisClient,
    logger: WarnLogger = new Logger(RedisLoginAttempts.name),
    now: () => number = Date.now,
  ) {
    this.warn = createRateLimitedWarn(logger, now)
  }

  /**
   * {@inheritDoc LoginAttemptsPort.fail}
   *
   * El vencimiento se pone con `NX` en cada fallo: solo lo toma el primero de la ventana, y si un
   * corte dejó la clave sin vencimiento el siguiente fallo lo repara.
   *
   * @throws {TypeError} En español, si el email está vacío.
   */
  async fail(email: string): Promise<{ blockedForSeconds: number | null }> {
    const key = failureKey(email)
    try {
      const failures = await this.redis.incr(key)
      await this.redis.expire(key, LOGIN_FAILURE_WINDOW_SECONDS, 'NX')
      if (failures < LOGIN_FAILURE_LIMIT) return { blockedForSeconds: null }
      return { blockedForSeconds: positiveOrNull(await this.redis.ttl(key)) }
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (no se cuenta el fallo): ${errorMessage(error)}`)
      return { blockedForSeconds: null }
    }
  }

  /**
   * {@inheritDoc LoginAttemptsPort.blockedFor}
   *
   * @throws {TypeError} En español, si el email está vacío.
   */
  async blockedFor(email: string): Promise<number | null> {
    const key = failureKey(email)
    try {
      const failures = Number(await this.redis.get(key))
      if (Number.isNaN(failures) || failures < LOGIN_FAILURE_LIMIT) return null
      return positiveOrNull(await this.redis.ttl(key))
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (se deja pasar): ${errorMessage(error)}`)
      return null
    }
  }

  /**
   * {@inheritDoc LoginAttemptsPort.clear}
   *
   * @throws {TypeError} En español, si el email está vacío.
   */
  async clear(email: string): Promise<void> {
    const key = failureKey(email)
    try {
      await this.redis.del(key)
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (no se limpian los fallos): ${errorMessage(error)}`)
    }
  }
}

function failureKey(email: string): string {
  if (email.trim() === '') throw new TypeError('El email no puede estar vacío')
  return `login-fail:${email}`
}

function positiveOrNull(seconds: number): number | null {
  return seconds > 0 ? seconds : null
}
