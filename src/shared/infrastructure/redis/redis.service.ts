import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common'
import { Redis } from 'ioredis'

import { ENV, type Env } from '../../../config/env'
import { createRateLimitedWarn, errorMessage } from './rate-limited-warn'

/** Cuánto espera el arranque a que Redis esté listo antes de seguir sin él. */
const READY_TIMEOUT_MS = 2_000

/**
 * Conexión compartida a Redis (ioredis) para la caché, el rate limiting y el health.
 *
 * Pensada para **fallar abierta**: sin cola offline, con Redis caído los comandos fallan al
 * instante (y no esperan en cola), así la caché y el rate limiting siguen sin él; `commandTimeout`
 * corta los comandos colgados. El cliente se reconecta solo. BullMQ (outbox) necesita su propia
 * conexión con `maxRetriesPerRequest: null`: no reusa esta.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  /** Cliente de ioredis; los adaptadores lo reciben por su `*.module.ts`. */
  readonly client: Redis

  private readonly logger = new Logger(RedisService.name)
  private readonly warn = createRateLimitedWarn(this.logger)

  /**
   * Crea el cliente con `REDIS_URL`, ya validada por `ConfigModule` al arrancar.
   *
   * @param env - Variables de entorno validadas (token `ENV`).
   */
  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
    })
    this.client.on('error', (error: Error) => {
      this.warn(
        `Redis no responde (se sigue sin caché ni rate limiting compartido): ${error.message}`,
      )
    })
  }

  /** Espera a que Redis esté listo (hasta 2 s); si no llega, la API arranca igual sin él. */
  async onModuleInit(): Promise<void> {
    if (!(await waitUntilReady(this.client, READY_TIMEOUT_MS))) {
      this.logger.warn('Redis no está listo al arrancar: la API sigue y se reconecta sola')
    }
  }

  /**
   * Manda un `PING`.
   *
   * @throws Error si Redis no responde (caído, desconectado o colgado más de 1 s).
   */
  async ping(): Promise<void> {
    await this.client.ping()
  }

  /** Cierra la conexión al apagar la app (`quit` ordenado o, si Redis no responde, corte). */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit()
    } catch (error) {
      this.logger.debug(`QUIT falló, se corta la conexión: ${errorMessage(error)}`)
      this.client.disconnect()
    }
  }
}

function waitUntilReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true)
  return new Promise((resolve) => {
    const onReady = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      client.off('ready', onReady)
      resolve(false)
    }, timeoutMs)
    client.once('ready', onReady)
  })
}
