import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import type { Env } from '../../../config/env'
import { buildPinoHttpOptions } from './logger.module'

const BASE: Env = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
  ADMIN_ORIGIN: 'http://localhost:5173',
  STORE_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'warn',
  MP_MODE: 'live',
  MP_STATEMENT_DESCRIPTOR: 'GALPON MATES',
  MEDIA_MODE: 'cloudinary',
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

  it('enmascara cookies, Authorization, Referer, el token CSRF y el token del pedido', () => {
    expect(buildPinoHttpOptions(BASE).redact).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers.referer',
      'req.headers["x-csrf-token"]',
      'req.headers["x-order-token"]',
      'res.headers["set-cookie"]',
    ])
  })

  it('no deja en el log el token de recuperación del Referer, el token CSRF ni el del pedido', () => {
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
    expect(output).not.toContain('sesion-secreta')
  })
})
