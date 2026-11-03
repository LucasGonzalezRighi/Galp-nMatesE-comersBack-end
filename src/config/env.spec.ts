import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

const REQUIRED = {
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
}

/** Mercado Pago real: las tres variables que exige `MP_MODE=live` (valores de mentira). */
const LIVE = {
  MP_MODE: 'live',
  MP_ACCESS_TOKEN: 'TEST-token-de-prueba',
  MP_WEBHOOK_SECRET: 'secreto-del-webhook',
  PUBLIC_API_ORIGIN: 'https://api.galpon.test',
}

const LIVE_MISSING =
  'Con MP_MODE=live hacen falta MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET y PUBLIC_API_ORIGIN.'
const PRODUCTION_SIMULATED = 'En producción MP_MODE tiene que ser live.'

/** Devuelve el mensaje del error que lanza `parseEnv`, o falla si no lanza. */
function errorOf(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('parseEnv no lanzó')
}

describe('parseEnv', () => {
  it('sin variables lanza un error en español que nombra DATABASE_URL y REDIS_URL', () => {
    const message = errorOf({})
    expect(message).toMatch(/^Variables de entorno inválidas/)
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('REDIS_URL')
  })

  it('con un PORT que no es número lanza un error que nombra PORT', () => {
    expect(errorOf({ ...REQUIRED, PORT: 'abc' })).toContain('PORT')
  })

  it('con las variables obligatorias completa el resto con los valores por defecto', () => {
    expect(parseEnv(REQUIRED)).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      DATABASE_URL: REQUIRED.DATABASE_URL,
      REDIS_URL: REQUIRED.REDIS_URL,
      ADMIN_ORIGIN: 'http://localhost:5173',
      STORE_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      MP_MODE: 'simulated',
      MP_STATEMENT_DESCRIPTOR: 'GALPON MATES',
    })
  })

  it('convierte PORT a número y respeta los valores que vienen', () => {
    const env = parseEnv({
      ...REQUIRED,
      ...LIVE,
      NODE_ENV: 'production',
      PORT: '4000',
      LOG_LEVEL: 'warn',
    })
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: 4000, LOG_LEVEL: 'warn' })
  })

  it('rechaza una DATABASE_URL que no es de Postgres sin mostrar su valor', () => {
    const message = errorOf({ ...REQUIRED, DATABASE_URL: 'mysql://root:secreto@localhost/galpon' })
    expect(message).toContain('DATABASE_URL')
    expect(message).not.toContain('secreto')
  })

  describe('Mercado Pago', () => {
    it('sin variables de MP queda en modo simulado y sin credenciales', () => {
      const env = parseEnv(REQUIRED)
      expect(env).toMatchObject({ MP_MODE: 'simulated', MP_STATEMENT_DESCRIPTOR: 'GALPON MATES' })
      expect(env.MP_ACCESS_TOKEN).toBeUndefined()
      expect(env.MP_WEBHOOK_SECRET).toBeUndefined()
      expect(env.PUBLIC_API_ORIGIN).toBeUndefined()
    })

    it('con MP_MODE=live y las tres variables las devuelve tal cual', () => {
      expect(parseEnv({ ...REQUIRED, ...LIVE })).toMatchObject(LIVE)
    })

    it('con MP_MODE=live sin el token lanza el mensaje exacto, sin mostrar valores', () => {
      const message = errorOf({ ...REQUIRED, ...LIVE, MP_ACCESS_TOKEN: undefined })
      expect(message).toMatch(/^Variables de entorno inválidas/)
      expect(message).toContain(`- ${LIVE_MISSING}`)
      expect(message).not.toContain(LIVE.MP_WEBHOOK_SECRET)
    })

    it('con MP_MODE=live sin el secreto ni el origen lanza el mismo mensaje una sola vez', () => {
      const message = errorOf({
        ...REQUIRED,
        ...LIVE,
        MP_WEBHOOK_SECRET: undefined,
        PUBLIC_API_ORIGIN: undefined,
      })
      expect(message.split(LIVE_MISSING)).toHaveLength(2)
    })

    it('en producción con MP_MODE=simulated (o sin MP_MODE) lanza el mensaje exacto', () => {
      expect(errorOf({ ...REQUIRED, NODE_ENV: 'production' })).toContain(
        `- ${PRODUCTION_SIMULATED}`,
      )
      expect(errorOf({ ...REQUIRED, NODE_ENV: 'production', MP_MODE: 'simulated' })).toContain(
        PRODUCTION_SIMULATED,
      )
    })

    it('rechaza un MP_MODE desconocido', () => {
      expect(errorOf({ ...REQUIRED, MP_MODE: 'sandbox' })).toContain('MP_MODE')
    })

    it('MP_STATEMENT_DESCRIPTOR admite hasta 13 caracteres', () => {
      expect(parseEnv({ ...REQUIRED, MP_STATEMENT_DESCRIPTOR: 'GALPON MATES!' })).toMatchObject({
        MP_STATEMENT_DESCRIPTOR: 'GALPON MATES!',
      })
      expect(errorOf({ ...REQUIRED, MP_STATEMENT_DESCRIPTOR: 'GALPON MATES!!' })).toContain(
        'MP_STATEMENT_DESCRIPTOR',
      )
      expect(errorOf({ ...REQUIRED, MP_STATEMENT_DESCRIPTOR: '' })).toContain(
        'MP_STATEMENT_DESCRIPTOR',
      )
    })

    it('PUBLIC_API_ORIGIN tiene que ser un origen http(s) sin ruta', () => {
      for (const value of [
        'https://api.galpon.test/api/v1',
        'https://api.galpon.test/',
        'ftp://x.y',
      ]) {
        expect(errorOf({ ...REQUIRED, PUBLIC_API_ORIGIN: value })).toContain('PUBLIC_API_ORIGIN')
      }
      expect(parseEnv({ ...REQUIRED, PUBLIC_API_ORIGIN: 'http://localhost:3001' })).toMatchObject({
        PUBLIC_API_ORIGIN: 'http://localhost:3001',
      })
    })

    it('rechaza un MP_ACCESS_TOKEN o un MP_WEBHOOK_SECRET vacíos', () => {
      expect(errorOf({ ...REQUIRED, MP_ACCESS_TOKEN: '' })).toContain('MP_ACCESS_TOKEN')
      expect(errorOf({ ...REQUIRED, MP_WEBHOOK_SECRET: '' })).toContain('MP_WEBHOOK_SECRET')
    })
  })
})
