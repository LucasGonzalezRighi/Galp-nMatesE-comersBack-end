import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

const REQUIRED = {
  NODE_ENV: 'development',
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

/** Fotos en Cloudinary: las tres variables que exige `MEDIA_MODE=cloudinary` (de mentira). */
const CLOUDINARY = {
  MEDIA_MODE: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'galpon-test',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'secreto-de-cloudinary',
}

const MEDIA_MISSING =
  'Con MEDIA_MODE=cloudinary hacen falta CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.'
const MEDIA_PRODUCTION_SIMULATED = 'En producción MEDIA_MODE tiene que ser cloudinary.'

/** Secreto de revalidación de la tienda (32 caracteres, de mentira). */
const STORE_SECRET = 'x'.repeat(32)
const STORE_SECRET_PRODUCTION =
  'En producción hace falta STORE_REVALIDATE_SECRET (el mismo REVALIDATE_SECRET de la tienda).'

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

  describe('NODE_ENV y HOST', () => {
    /** Producción completa: Mercado Pago real, Cloudinary y el secreto de la tienda. */
    const PRODUCTION = {
      ...REQUIRED,
      ...LIVE,
      ...CLOUDINARY,
      NODE_ENV: 'production',
      STORE_REVALIDATE_SECRET: STORE_SECRET,
    }

    it('sin NODE_ENV no arranca: el error pide development, test o production explícito (NV-07)', () => {
      const message = errorOf({
        DATABASE_URL: REQUIRED.DATABASE_URL,
        REDIS_URL: REQUIRED.REDIS_URL,
      })

      expect(message).toContain('- NODE_ENV: falta; se espera development, test o production')
      expect(message).toContain('sin NODE_ENV el back no arranca')
      expect(errorOf({ ...REQUIRED, NODE_ENV: 'prod' })).toContain(
        '- NODE_ENV: tiene un valor inválido',
      )
    })

    it('HOST por defecto: 127.0.0.1 fuera de producción y 0.0.0.0 en producción (NV-31)', () => {
      expect(parseEnv(REQUIRED).HOST).toBe('127.0.0.1')
      expect(parseEnv({ ...REQUIRED, NODE_ENV: 'test' }).HOST).toBe('127.0.0.1')
      expect(parseEnv(PRODUCTION).HOST).toBe('0.0.0.0')
    })

    it('HOST respeta una IP o localhost y rechaza otra cosa sin mostrar el valor', () => {
      expect(parseEnv({ ...REQUIRED, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0')
      expect(parseEnv({ ...PRODUCTION, HOST: '10.0.0.5' }).HOST).toBe('10.0.0.5')
      expect(parseEnv({ ...REQUIRED, HOST: '::' }).HOST).toBe('::')
      expect(parseEnv({ ...REQUIRED, HOST: 'localhost' }).HOST).toBe('localhost')
      const message = errorOf({ ...REQUIRED, HOST: 'mi host raro' })
      expect(message).toContain('- HOST: tiene un valor inválido')
      expect(message).not.toContain('mi host raro')
    })
  })

  describe('TRUST_PROXY (NV-25)', () => {
    it('apagada por defecto (sin la variable o vacía)', () => {
      expect(parseEnv(REQUIRED).TRUST_PROXY).toEqual([])
      expect(parseEnv({ ...REQUIRED, TRUST_PROXY: ' , ' }).TRUST_PROXY).toEqual([])
    })

    it('acepta IPs, redes CIDR y los nombres de Express, separados por comas', () => {
      const env = parseEnv({
        ...REQUIRED,
        TRUST_PROXY: ' 10.0.0.5, 10.1.0.0/16 ,fd00::/8,::1, loopback,uniquelocal',
      })
      expect(env.TRUST_PROXY).toEqual([
        '10.0.0.5',
        '10.1.0.0/16',
        'fd00::/8',
        '::1',
        'loopback',
        'uniquelocal',
      ])
    })

    it('rechaza true, un número de saltos o un nombre de host, sin mostrar el valor', () => {
      for (const value of ['true', '7', 'tienda.local', '192.0.2.1,mi proxy']) {
        const message = errorOf({ ...REQUIRED, TRUST_PROXY: value })
        expect(message).toContain(
          '- TRUST_PROXY: tiene un valor inválido; se espera IPs o redes CIDR',
        )
        expect(message).not.toContain(value)
      }
    })
  })

  it('con un PORT que no es número lanza un error que nombra PORT', () => {
    expect(errorOf({ ...REQUIRED, PORT: 'abc' })).toContain('PORT')
  })

  it('con las variables obligatorias completa el resto con los valores por defecto', () => {
    expect(parseEnv(REQUIRED)).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3001,
      TRUST_PROXY: [],
      DATABASE_URL: REQUIRED.DATABASE_URL,
      REDIS_URL: REQUIRED.REDIS_URL,
      ADMIN_ORIGIN: 'http://localhost:5173',
      STORE_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      MP_MODE: 'simulated',
      MP_STATEMENT_DESCRIPTOR: 'GALPON MATES',
      MEDIA_MODE: 'simulated',
    })
  })

  it('convierte PORT a número y respeta los valores que vienen', () => {
    const env = parseEnv({
      ...REQUIRED,
      ...LIVE,
      ...CLOUDINARY,
      NODE_ENV: 'production',
      STORE_REVALIDATE_SECRET: STORE_SECRET,
      PORT: '4000',
      LOG_LEVEL: 'warn',
    })
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: 4000, LOG_LEVEL: 'warn' })
  })

  describe('Aviso a la tienda', () => {
    it('STORE_REVALIDATE_SECRET es opcional fuera de producción', () => {
      expect(parseEnv(REQUIRED).STORE_REVALIDATE_SECRET).toBeUndefined()
      expect(parseEnv({ ...REQUIRED, NODE_ENV: 'test' }).STORE_REVALIDATE_SECRET).toBeUndefined()
      expect(
        parseEnv({ ...REQUIRED, STORE_REVALIDATE_SECRET: STORE_SECRET }).STORE_REVALIDATE_SECRET,
      ).toBe(STORE_SECRET)
    })

    it('con menos de 32 caracteres lanza un error con la pista, sin mostrar el valor', () => {
      const short = 'y'.repeat(31)
      const message = errorOf({ ...REQUIRED, STORE_REVALIDATE_SECRET: short })
      expect(message).toContain(
        'STORE_REVALIDATE_SECRET: tiene un valor inválido; se espera el mismo REVALIDATE_SECRET de la tienda, de 32 caracteres o más',
      )
      expect(message).not.toContain(short)
    })

    it('en producción sin el secreto lanza el mensaje exacto', () => {
      const message = errorOf({ ...REQUIRED, ...LIVE, ...CLOUDINARY, NODE_ENV: 'production' })
      expect(message).toContain(STORE_SECRET_PRODUCTION)
      expect(message.split(STORE_SECRET_PRODUCTION)).toHaveLength(2)
    })
  })

  it('rechaza una DATABASE_URL que no es de Postgres sin mostrar su valor', () => {
    const message = errorOf({ ...REQUIRED, DATABASE_URL: 'mysql://root:secreto@localhost/galpon' })
    expect(message).toContain('DATABASE_URL')
    expect(message).not.toContain('secreto')
  })

  describe('Fotos (Cloudinary)', () => {
    it('sin variables de fotos queda en modo simulado y sin credenciales', () => {
      const env = parseEnv(REQUIRED)
      expect(env.MEDIA_MODE).toBe('simulated')
      expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined()
      expect(env.CLOUDINARY_API_KEY).toBeUndefined()
      expect(env.CLOUDINARY_API_SECRET).toBeUndefined()
    })

    it('con MEDIA_MODE=cloudinary y las tres variables las devuelve tal cual', () => {
      expect(parseEnv({ ...REQUIRED, ...CLOUDINARY })).toMatchObject(CLOUDINARY)
    })

    it('con MEDIA_MODE=cloudinary sin alguna variable lanza el mensaje exacto una sola vez', () => {
      const message = errorOf({
        ...REQUIRED,
        ...CLOUDINARY,
        CLOUDINARY_API_KEY: undefined,
        CLOUDINARY_API_SECRET: undefined,
      })
      expect(message).toContain(`- ${MEDIA_MISSING}`)
      expect(message.split(MEDIA_MISSING)).toHaveLength(2)
      expect(errorOf({ ...REQUIRED, ...CLOUDINARY, CLOUDINARY_CLOUD_NAME: undefined })).toContain(
        MEDIA_MISSING,
      )
    })

    it('en producción con MEDIA_MODE=simulated (o sin MEDIA_MODE) lanza el mensaje exacto', () => {
      const production = {
        ...REQUIRED,
        ...LIVE,
        NODE_ENV: 'production',
        STORE_REVALIDATE_SECRET: STORE_SECRET,
      }
      expect(errorOf(production)).toContain(`- ${MEDIA_PRODUCTION_SIMULATED}`)
      expect(errorOf({ ...production, MEDIA_MODE: 'simulated' })).toContain(
        MEDIA_PRODUCTION_SIMULATED,
      )
    })

    it('rechaza un MEDIA_MODE desconocido o una credencial vacía, sin mostrar el secreto', () => {
      expect(errorOf({ ...REQUIRED, MEDIA_MODE: 'local' })).toContain('MEDIA_MODE')
      const message = errorOf({ ...REQUIRED, ...CLOUDINARY, CLOUDINARY_API_SECRET: '' })
      expect(message).toContain('CLOUDINARY_API_SECRET')
      expect(message).not.toContain(CLOUDINARY.CLOUDINARY_API_KEY)
    })
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
