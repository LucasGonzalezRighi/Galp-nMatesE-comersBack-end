import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pino } from 'pino'
import { pinoHttp } from 'pino-http'
import { describe, expect, it } from 'vitest'

import type { Env } from '../../../config/env'
import { buildPinoHttpOptions, serializeRequest } from './logger.module'

const BASE: Env = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: 3001,
  TRUST_PROXY: [],
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
  ADMIN_ORIGIN: 'http://localhost:5173',
  STORE_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'warn',
  MP_MODE: 'live',
  MP_STATEMENT_DESCRIPTOR: 'GALPON MATES',
  MEDIA_MODE: 'cloudinary',
  MAIL_MODE: 'smtp',
}

describe('buildPinoHttpOptions', () => {
  it('usa LOG_LEVEL y no agrega transporte fuera de desarrollo', () => {
    const options = buildPinoHttpOptions(BASE)
    expect(options.level).toBe('warn')
    expect(options.transport).toBeUndefined()
  })

  it('en test no loguea nada', () => {
    expect(buildPinoHttpOptions({ ...BASE, NODE_ENV: 'test' }).level).toBe('silent')
  })

  it('enmascara cookies, Authorization, Referer, el token CSRF, el token del pedido, la Idempotency-Key y el secreto del proxy', () => {
    expect(buildPinoHttpOptions(BASE).redact).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers.referer',
      'req.headers["x-csrf-token"]',
      'req.headers["x-order-token"]',
      'req.headers["idempotency-key"]',
      'req.headers["x-galpon-proxy-secret"]',
      'res.headers["set-cookie"]',
    ])
  })

  it('no deja en el log el token de recuperación del Referer, el token CSRF, el del pedido, la Idempotency-Key ni el secreto del proxy', () => {
    const lines: string[] = []
    const logger = pino(
      { level: 'info', redact: buildPinoHttpOptions(BASE).redact ?? [] },
      { write: (line: string) => lines.push(line) },
    )

    logger.info(
      {
        req: {
          headers: {
            referer: 'http://localhost:3000/cuenta/restablecer?token=rt_secreto',
            'x-csrf-token': 'csrf-secreto',
            'x-order-token': 'ot_secreto',
            // NV-01: con la clave y la URL, quien lee los logs repetía la preferencia sin token.
            'idempotency-key': 'clave-idempotente-secreta',
            // Defensa en profundidad: el middleware ya la borra antes de que el logger la vea.
            'x-galpon-proxy-secret': 'secreto-del-proxy-de-la-tienda',
            cookie: '__Host-galpon_session=sesion-secreta',
          },
        },
      },
      'request completed',
    )

    const output = lines.join('')
    expect(output).toContain('request completed')
    expect(output).not.toContain('rt_secreto')
    expect(output).not.toContain('csrf-secreto')
    expect(output).not.toContain('ot_secreto')
    expect(output).not.toContain('clave-idempotente-secreta')
    expect(output).not.toContain('secreto-del-proxy-de-la-tienda')
    expect(output).not.toContain('sesion-secreta')
  })
})

describe('serializeRequest', () => {
  it('Review Focus 5: deja la ruta y los nombres de la query, sin sus valores', () => {
    const serialized = serializeRequest({
      id: 1,
      method: 'GET',
      url: '/api/v1/admin/orders?q=juan%40mail.com&status=paid&q=otro',
      query: { q: 'juan@mail.com', status: 'paid' },
      params: { number: 'GLP-10001' },
      headers: { 'user-agent': 'vitest' },
      remoteAddress: '127.0.0.1',
      remotePort: 5000,
    })

    expect(serialized).toEqual({
      id: 1,
      method: 'GET',
      url: '/api/v1/admin/orders',
      query: ['q', 'status'],
      headers: { 'user-agent': 'vitest' },
      remoteAddress: '127.0.0.1',
      remotePort: 5000,
    })
    expect(JSON.stringify(serialized)).not.toContain('juan')
  })

  it('sin query deja la ruta tal cual y una lista vacía', () => {
    expect(serializeRequest({ method: 'POST', url: '/api/v1/orders' })).toMatchObject({
      url: '/api/v1/orders',
      query: [],
    })
  })

  it('pino-http con estas opciones no escribe el valor de la búsqueda del admin', async () => {
    const lines: string[] = []
    const options = buildPinoHttpOptions({ ...BASE, LOG_LEVEL: 'info' })
    const middleware = pinoHttp(options, { write: (line: string) => lines.push(line) })
    const server = createServer((req, res) => {
      middleware(req, res)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      await fetch(
        `http://127.0.0.1:${String(port)}/api/v1/admin/orders?q=juan@mail.com&page=2`,
      ).then((response) => response.text())
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }

    const output = lines.join('')
    expect(output).toContain('"url":"/api/v1/admin/orders"')
    expect(output).toContain('"query":["q","page"]')
    expect(output).not.toContain('juan')
  })
})
