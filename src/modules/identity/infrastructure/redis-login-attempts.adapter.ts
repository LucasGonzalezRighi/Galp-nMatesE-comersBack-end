import { Logger } from '@nestjs/common'

import {
  createRateLimitedWarn,
  errorMessage,
  type WarnLogger,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import type {
  LoginAttempt,
  LoginAttemptKey,
  LoginAttemptsPort,
} from '../application/ports/login-attempts.port'

/** Intentos que se verifican por email e IP dentro de la ventana (Ruling B-7). */
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
  /** `DEL key`. */
  del(key: string): Promise<number>
}

/** Intento que se puede verificar sin que arranque un bloqueo. */
const FREE: LoginAttempt = { blockedForSeconds: null, lockedIfFailsSeconds: null }

/**
 * {@link LoginAttemptsPort} sobre Redis: un contador `login-fail:{ip}:{email}` (la IP va
 * codificada, así sus `:` no se confunden con el separador) que suma con `INCR` antes de cada
 * verificación y vence a los 15 minutos del primer intento. El intento número 10 todavía se
 * verifica (si falla, bloquea); del 11 en adelante, el par queda bloqueado por el TTL que le queda.
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
   * {@inheritDoc LoginAttemptsPort.attempt}
   *
   * `INCR` es atómico: cada intento a la vez recibe su propio número, así nunca se verifican más de
   * {@link LOGIN_FAILURE_LIMIT} por ventana. El vencimiento se pone con `NX` en cada intento: solo
   * lo toma el primero de la ventana, y si un corte dejó la clave sin vencimiento el siguiente lo
   * repara. Si el TTL no se puede leer, el bloqueo dura la ventana entera.
   *
   * @throws {TypeError} En español, si el email o la IP están vacíos.
   */
  async attempt(key: LoginAttemptKey): Promise<LoginAttempt> {
    const redisKey = attemptKey(key)
    try {
      const attempts = await this.redis.incr(redisKey)
      await this.redis.expire(redisKey, LOGIN_FAILURE_WINDOW_SECONDS, 'NX')
      if (attempts < LOGIN_FAILURE_LIMIT) return FREE
      const remaining = await this.redis.ttl(redisKey)
      const seconds = remaining > 0 ? remaining : LOGIN_FAILURE_WINDOW_SECONDS
      return attempts > LOGIN_FAILURE_LIMIT
        ? { blockedForSeconds: seconds, lockedIfFailsSeconds: null }
        : { blockedForSeconds: null, lockedIfFailsSeconds: seconds }
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (se deja pasar): ${errorMessage(error)}`)
      return FREE
    }
  }

  /**
   * {@inheritDoc LoginAttemptsPort.clear}
   *
   * @throws {TypeError} En español, si el email o la IP están vacíos.
   */
  async clear(key: LoginAttemptKey): Promise<void> {
    const redisKey = attemptKey(key)
    try {
      await this.redis.del(redisKey)
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (no se limpian los fallos): ${errorMessage(error)}`)
    }
  }
}

function attemptKey({ email, clientIp }: LoginAttemptKey): string {
  if (email.trim() === '') throw new TypeError('El email no puede estar vacío')
  if (clientIp.trim() === '') throw new TypeError('La IP del cliente no puede estar vacía')
  return `login-fail:${encodeURIComponent(clientIp)}:${email}`
}
