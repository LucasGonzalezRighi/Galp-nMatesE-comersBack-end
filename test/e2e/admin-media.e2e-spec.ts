import type { INestApplication } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type { Category } from '../../src/modules/catalog/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import {
  call,
  type CallOptions,
  firstError,
  type HttpMethod,
  type Jar,
  newJar,
} from '../support/http'

const SECRET = 'secreto-de-cloudinary-de-prueba'

/** Firma de una subida, como la devuelve el back. */
interface Signature {
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  folder: string
}

describe('firma de fotos del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    MEDIA_MODE: process.env.MEDIA_MODE,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  }
  let admin: Jar = newJar()

  /**
   * Levanta la app con el modo de fotos pedido (la primera vez, siembra la base) y entra al
   * dashboard.
   */
  async function start(mode: 'simulated' | 'cloudinary'): Promise<void> {
    const first = app === undefined
    await app?.close()
    process.env.MEDIA_MODE = mode
    if (mode === 'cloudinary') {
      process.env.CLOUDINARY_CLOUD_NAME = 'galpon'
      process.env.CLOUDINARY_API_KEY = '123456789012345'
      process.env.CLOUDINARY_API_SECRET = SECRET
    }
    app = await createApp()
    if (first) await seed(app.get(PrismaService))
    admin = newJar()
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      Reflect.deleteProperty(process.env, key)
    }
    await start('simulated')
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  it('pide la sesión de admin (401) y el CSRF (403)', async () => {
    const anonymous = await call(server(), newJar(), 'post', '/admin/media/signature', {
      body: { purpose: 'product' },
    })
    expect(anonymous.status).toBe(401)
    const csrf = await http('post', '/admin/media/signature', {
      body: { purpose: 'product' },
      csrf: false,
    })
    expect(csrf.status).toBe(403)
    expect(csrf.body).toMatchObject({ type: 'csrf_invalid' })
  })

  it('simulado: la firma del mock, con la carpeta de cada uso', async () => {
    const before = Math.floor(Date.now() / 1000)
    const response = await http('post', '/admin/media/signature', { body: { purpose: 'product' } })
    expect(response.status).toBe(200)
    const signed = response.body as Signature
    expect(signed).toMatchObject({
      apiKey: 'mock-api-key',
      cloudName: 'galpon-mock',
      folder: 'galpon/productos',
    })
    expect(signed.signature).toMatch(/^mock-[0-9a-f]{40}$/)
    expect(signed.timestamp).toBeGreaterThanOrEqual(before)
    expect(signed.timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))

    for (const [purpose, folder] of [
      ['category', 'galpon/lineas'],
      ['partner', 'galpon/socios'],
      ['site', 'galpon/sitio'],
    ]) {
      const other = await http('post', '/admin/media/signature', { body: { purpose } })
      expect((other.body as Signature).folder).toBe(folder)
    }

    const invalid = await http('post', '/admin/media/signature', { body: { purpose: 'avatar' } })
    expect(invalid.status).toBe(422)
    expect(firstError(invalid)).toEqual({
      field: 'purpose',
      code: 'invalid_value',
      message: 'Elegí para qué es la foto',
    })
  })

  it('cloudinary: sha1 de folder y timestamp con el secreto, y las fotos nuevas con esa nube', async () => {
    await start('cloudinary')
    const response = await http('post', '/admin/media/signature', { body: { purpose: 'category' } })
    expect(response.status).toBe(200)
    const signed = response.body as Signature
    expect(signed).toMatchObject({
      apiKey: '123456789012345',
      cloudName: 'galpon',
      folder: 'galpon/lineas',
    })
    expect(signed.signature).toBe(
      createHash('sha1')
        .update(`folder=galpon/lineas&timestamp=${String(signed.timestamp)}${SECRET}`)
        .digest('hex'),
    )
    expect(JSON.stringify(signed)).not.toContain(SECRET)

    const created = await http('post', '/admin/categories', {
      body: {
        name: 'Calabazas',
        slug: 'calabazas',
        group: 'mate',
        blurb: 'Mates de calabaza.',
        image: { publicId: 'galpon/lineas/calabazas-1', width: 800, height: 600, alt: 'Línea' },
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect((created.body as Category).image?.url).toBe(
      'https://res.cloudinary.com/galpon/image/upload/galpon/lineas/calabazas-1',
    )
    expect(
      await prisma().mediaAsset.findUniqueOrThrow({
        where: { publicId: 'galpon/lineas/calabazas-1' },
      }),
    ).toMatchObject({ provider: 'cloudinary', width: 800, height: 600 })
  })
})
