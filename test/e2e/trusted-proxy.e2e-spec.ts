import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import type request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLIENT_IP_FROM_FORWARDED_FOR,
  CLIENT_IP_FROM_HEADER,
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
} from '../../src/shared/infrastructure/http/trusted-proxy'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, type Jar, newJar } from '../support/http'

/** `TRUSTED_PROXY_SECRET` del back de prueba: el mismo que manda "la tienda" (de mentira). */
const SECRET = 'secreto-de-prueba-compartido-con-la-tienda-2026'

/** Un secreto del mismo largo que no es el del back. */
const WRONG_SECRET = 'secreto-de-prueba-compartido-con-la-tienda-2027'

/** Límite de las escrituras de autenticación por IP (por minuto): `AUTH_WRITE_THROTTLE`. */
const LOGIN_LIMIT = 20

/** Límite de las lecturas públicas por IP real (por minuto): `PUBLIC_READ_RATE_LIMIT`. */
const PUBLIC_READ_LIMIT = 300

/** Fallos de inicio de sesión por email y cliente que bloquean (NV-09). */
const LOGIN_FAILURES_TO_LOCK = 10

/** Cabeceras de un pedido que la tienda reenvía por el visitante de esa IP. */
function fromStore(clientIp: string, secret = SECRET): Record<string, string> {
  return { [PROXY_SECRET_HEADER]: secret, [CLIENT_IP_HEADER]: clientIp }
}

/** Cabeceras de un pedido que reenvía el proxy del dashboard: la IP sale de `X-Forwarded-For`. */
function fromDashboard(forwardedFor: string): Record<string, string> {
  return {
    [PROXY_SECRET_HEADER]: SECRET,
    [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
    'X-Forwarded-For': forwardedFor,
  }
}

/** Cabeceras de un pedido que origina el servidor de la tienda (sin visitante). */
const STORE_SERVER = { [PROXY_SECRET_HEADER]: SECRET }

describe('IP del cliente autenticada con TRUSTED_PROXY_SECRET (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    TRUST_PROXY: process.env.TRUST_PROXY,
    TRUSTED_PROXY_SECRET: process.env.TRUSTED_PROXY_SECRET,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    // Como en Vercel + Render: sin proxies por IP, solo el secreto compartido.
    Reflect.deleteProperty(process.env, 'TRUST_PROXY')
    process.env.TRUSTED_PROXY_SECRET = SECRET
    app = await createApp()
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function send(
    jar: Jar,
    method: HttpMethod,
    path: string,
    options?: CallOptions,
  ): Promise<request.Response> {
    if (app === undefined) throw new Error('La app no arrancó')
    return call(app.getHttpServer(), jar, method, path, options)
  }

  /** Inicio de sesión sin token CSRF: pasa por el límite por IP y el guard lo corta con 403. */
  async function loginStatus(headers: Record<string, string>): Promise<number> {
    const response = await send(newJar(), 'post', '/auth/login', {
      body: { email: 'nadie@ejemplo.com', password: 'una-clave-cualquiera' },
      headers,
    })
    return response.status
  }

  /** Repite `GET path` `times` veces y devuelve los códigos. */
  async function repeatGet(
    path: string,
    times: number,
    headers: Record<string, string> = {},
  ): Promise<number[]> {
    const statuses: number[] = []
    for (let i = 0; i < times; i += 1) {
      statuses.push((await send(newJar(), 'get', path, { headers })).status)
    }
    return statuses
  }

  describe('límite por IP del login (20 por minuto)', () => {
    it('el cliente A llega al 429 y el cliente B, detrás de la misma tienda, no', async () => {
      const statuses: number[] = []
      for (let i = 0; i <= LOGIN_LIMIT; i += 1) {
        statuses.push(await loginStatus(fromStore('203.0.113.7')))
      }
      const other = await loginStatus(fromStore('203.0.113.8'))

      expect(statuses.slice(0, LOGIN_LIMIT)).toEqual(Array<number>(LOGIN_LIMIT).fill(403))
      expect(statuses[LOGIN_LIMIT]).toBe(429)
      expect(other).toBe(403)
    })

    it('A no se escapa agregando X-Forwarded-For', async () => {
      const status = await loginStatus({
        ...fromStore('203.0.113.7'),
        'X-Forwarded-For': '198.51.100.99',
      })

      expect(status).toBe(429)
    })

    it('con las tres cabeceras y un secreto equivocado el pedido es directo: no vale la IP que dice y todos comparten un contador', async () => {
      const spoofed = (clientIp: string): Record<string, string> => ({
        ...fromStore(clientIp, WRONG_SECRET),
        [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
        'X-Forwarded-For': clientIp,
      })

      // Dice ser A, que ya está en 429: como no trae el secreto, no se lo cuenta como A.
      const asBlocked = await loginStatus(spoofed('203.0.113.7'))
      const statuses: number[] = []
      for (let i = 1; i <= LOGIN_LIMIT; i += 1) {
        statuses.push(await loginStatus(spoofed(`198.51.100.${String(i)}`)))
      }
      const withoutHeaders = await loginStatus({})

      expect(asBlocked).toBe(403)
      // Con el anterior son 20 pedidos directos: cambiar de IP inventada no da un contador nuevo.
      expect(statuses.slice(0, LOGIN_LIMIT - 1)).toEqual(Array<number>(LOGIN_LIMIT - 1).fill(403))
      expect(statuses[LOGIN_LIMIT - 1]).toBe(429)
      expect(withoutHeaders).toBe(429)
      // El que entra por la tienda sigue con su propio contador.
      expect(await loginStatus(fromStore('203.0.113.8'))).toBe(403)
    })

    it('con x-galpon-client-ip-from: x-forwarded-for cuenta por la primera IP de X-Forwarded-For, y un x-galpon-client-ip inventado no la cambia', async () => {
      const statuses: number[] = []
      for (let i = 0; i <= LOGIN_LIMIT; i += 1) {
        // El visitante inventa una x-galpon-client-ip distinta en cada pedido.
        statuses.push(
          await loginStatus({
            ...fromDashboard(`203.0.113.50, 10.0.0.${String(i + 1)}`),
            [CLIENT_IP_HEADER]: `192.0.2.${String(i + 1)}`,
          }),
        )
      }
      const sameClient = await loginStatus(fromDashboard('203.0.113.50'))
      const otherClient = await loginStatus({
        ...fromDashboard('203.0.113.51, 203.0.113.50'),
        // Tampoco sirve para hacerse pasar por otro: acá mandaría el cliente bloqueado.
        [CLIENT_IP_HEADER]: '203.0.113.50',
      })

      expect(statuses.slice(0, LOGIN_LIMIT)).toEqual(Array<number>(LOGIN_LIMIT).fill(403))
      expect(statuses[LOGIN_LIMIT]).toBe(429)
      expect(sameClient).toBe(429)
      expect(otherClient).toBe(403)
    })
  })

  describe('bloqueo de login por cliente (NV-09)', () => {
    it('la IP que manda la tienda llega al bloqueo por intentos: una red IPv6 /64 es un solo cliente', async () => {
      const email = 'red@ejemplo.com'
      const password = 'no-es-la-clave-1'
      const jar = newJar()
      const csrf = await send(jar, 'get', '/auth/csrf', { headers: fromStore('2001:db8:9:1::1') })
      jar.csrf = (csrf.body as { csrfToken: string }).csrfToken
      const loginFrom = async (clientIp: string): Promise<number> => {
        const response = await send(jar, 'post', '/auth/login', {
          body: { email, password },
          headers: fromStore(clientIp),
        })
        return response.status
      }

      const statuses: number[] = []
      for (let host = 1; host <= LOGIN_FAILURES_TO_LOCK; host += 1) {
        statuses.push(await loginFrom(`2001:db8:9:1::${host.toString(16)}`))
      }
      const sameNetwork = await loginFrom('2001:db8:9:1:ffff:ffff:ffff:fffe')
      const otherNetwork = await loginFrom('2001:db8:9:2::1')

      expect(statuses).toEqual([...Array<number>(LOGIN_FAILURES_TO_LOCK - 1).fill(401), 429])
      expect(sameNetwork).toBe(429)
      expect(otherNetwork).toBe(401)
    })
  })

  describe('lecturas públicas (300 por minuto por IP real)', () => {
    it('el servidor de la tienda (secreto, sin cliente) no se cuenta', async () => {
      const statuses = await repeatGet('/categories', PUBLIC_READ_LIMIT + 1, STORE_SERVER)

      expect(statuses).toEqual(Array<number>(PUBLIC_READ_LIMIT + 1).fill(200))
    })

    it('el visitante que reenvía la tienda se cuenta por su IP: pasa el límite → 429, y otro visitante sigue', async () => {
      const client = await repeatGet(
        '/categories',
        PUBLIC_READ_LIMIT + 1,
        fromStore('203.0.113.60'),
      )
      const other = await repeatGet('/categories', 1, fromStore('203.0.113.61'))

      expect(client.slice(0, PUBLIC_READ_LIMIT)).toEqual(Array<number>(PUBLIC_READ_LIMIT).fill(200))
      expect(client[PUBLIC_READ_LIMIT]).toBe(429)
      expect(other).toEqual([200])
    })

    it('el que llega directo, sin el secreto, se cuenta por la IP con la que llega; la tienda sigue sin límite', async () => {
      const direct = await repeatGet('/categories', PUBLIC_READ_LIMIT + 1)
      const store = await repeatGet('/categories', 1, STORE_SERVER)

      expect(direct.slice(0, PUBLIC_READ_LIMIT)).toEqual(Array<number>(PUBLIC_READ_LIMIT).fill(200))
      expect(direct[PUBLIC_READ_LIMIT]).toBe(429)
      expect(store).toEqual([200])
    })
  })
})
