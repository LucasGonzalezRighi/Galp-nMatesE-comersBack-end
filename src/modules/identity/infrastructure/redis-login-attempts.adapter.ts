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

/**
 * Intentos que se verifican por email dentro de su ventana, desde cualquier IP (NV-09): frena a
 * quien rota IPs sin dejar que un anónimo bloquee al dueño con pocos intentos.
 */
export const LOGIN_EMAIL_FAILURE_LIMIT = 100

/** Largo de la ventana del tope por email en segundos: una hora desde el primer fallo. */
export const LOGIN_EMAIL_FAILURE_WINDOW_SECONDS = 3_600

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
 * {@link LoginAttemptsPort} sobre Redis, con dos contadores que suman con `INCR` antes de cada
 * verificación:
 *
 * - `login-fail:{ip}:{email}` (la IP va codificada, así sus `:` no se confunden con el separador),
 *   que vence a los 15 minutos del primer intento: el intento número 10 todavía se verifica (si
 *   falla, bloquea); del 11 en adelante, el par queda bloqueado por el TTL que le queda;
 * - `login-fail-email:{email}` (NV-09), que vence a la hora del primer intento: con
 *   {@link LOGIN_EMAIL_FAILURE_LIMIT} el email queda bloqueado desde cualquier IP. Solo suma lo que
 *   el par deja verificar, así los intentos de una IP ya bloqueada no le gastan el tope al dueño.
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
   * {@link LOGIN_FAILURE_LIMIT} por par ni {@link LOGIN_EMAIL_FAILURE_LIMIT} por email en cada
   * ventana. Primero cuenta el par: si ya está bloqueado, el intento no toca el contador del email.
   * Si los dos avisan un bloqueo, arranca el más largo.
   *
   * @throws {TypeError} En español, si el email o la IP están vacíos.
   */
  async attempt(key: LoginAttemptKey): Promise<LoginAttempt> {
    const pairKey = attemptKey(key)
    const emailKey = emailAttemptKey(key.email)
    try {
      const pair = await this.count(pairKey, LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_SECONDS)
      if (pair.blockedForSeconds !== null) return pair
      const email = await this.count(
        emailKey,
        LOGIN_EMAIL_FAILURE_LIMIT,
        LOGIN_EMAIL_FAILURE_WINDOW_SECONDS,
      )
      return email.blockedForSeconds !== null
        ? email
        : { ...FREE, lockedIfFailsSeconds: longest(pair, email) }
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (se deja pasar): ${errorMessage(error)}`)
      return FREE
    }
  }

  /**
   * {@inheritDoc LoginAttemptsPort.clear}
   *
   * Borra el par y el contador del email: solo llega acá quien sabe la contraseña.
   *
   * @throws {TypeError} En español, si el email o la IP están vacíos.
   */
  async clear(key: LoginAttemptKey): Promise<void> {
    const pairKey = attemptKey(key)
    const emailKey = emailAttemptKey(key.email)
    try {
      await this.redis.del(pairKey)
      await this.redis.del(emailKey)
    } catch (error) {
      this.warn(`Bloqueo de intentos sin Redis (no se limpian los fallos): ${errorMessage(error)}`)
    }
  }

  /**
   * Suma un intento a un contador y dice qué pasa con él. El vencimiento se pone con `NX` en cada
   * intento: solo lo toma el primero de la ventana, y si un corte dejó la clave sin vencimiento el
   * siguiente lo repara. Si el TTL no se puede leer, el bloqueo dura la ventana entera.
   */
  private async count(
    redisKey: string,
    limit: number,
    windowSeconds: number,
  ): Promise<LoginAttempt> {
    const attempts = await this.redis.incr(redisKey)
    await this.redis.expire(redisKey, windowSeconds, 'NX')
    if (attempts < limit) return FREE
    const remaining = await this.redis.ttl(redisKey)
    const seconds = remaining > 0 ? remaining : windowSeconds
    return attempts > limit
      ? { blockedForSeconds: seconds, lockedIfFailsSeconds: null }
      : { blockedForSeconds: null, lockedIfFailsSeconds: seconds }
  }
}

/** El bloqueo más largo que arranca si el intento falla, o `null` si ninguno arranca. */
function longest(...attempts: LoginAttempt[]): number | null {
  const seconds = attempts.flatMap(({ lockedIfFailsSeconds }) =>
    lockedIfFailsSeconds === null ? [] : [lockedIfFailsSeconds],
  )
  return seconds.length === 0 ? null : Math.max(...seconds)
}

function attemptKey({ email, clientIp }: LoginAttemptKey): string {
  if (email.trim() === '') throw new TypeError('El email no puede estar vacío')
  if (clientIp.trim() === '') throw new TypeError('La IP del cliente no puede estar vacía')
  return `login-fail:${encodeURIComponent(clientIp)}:${email}`
}

/** Clave del tope por email (NV-09), sin la IP. */
function emailAttemptKey(email: string): string {
  return `login-fail-email:${email}`
}
