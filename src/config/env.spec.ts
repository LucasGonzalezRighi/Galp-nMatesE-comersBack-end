import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

const REQUIRED = {
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
}

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
    })
  })

  it('convierte PORT a número y respeta los valores que vienen', () => {
    const env = parseEnv({ ...REQUIRED, NODE_ENV: 'production', PORT: '4000', LOG_LEVEL: 'warn' })
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: 4000, LOG_LEVEL: 'warn' })
  })

  it('rechaza una DATABASE_URL que no es de Postgres sin mostrar su valor', () => {
    const message = errorOf({ ...REQUIRED, DATABASE_URL: 'mysql://root:secreto@localhost/galpon' })
    expect(message).toContain('DATABASE_URL')
    expect(message).not.toContain('secreto')
  })
})
