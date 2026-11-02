import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import {
  call as httpCall,
  type CallOptions,
  firstError,
  type HttpMethod,
  type Jar,
  newJar,
  refreshCsrf as httpRefreshCsrf,
  setCookies,
} from '../support/http'
import { RecordingMailer } from '../support/identity'

/** Contraseña de la cuenta de prueba y la que elige al recuperarla. */
const PASSWORD = 'mate-con-yerba-2026'
const NEW_PASSWORD = 'yerba-nueva-2027'

/** Contraseña nueva del admin semilla (la cambia el test del dashboard). */
const NEW_ADMIN_PASSWORD = 'galpon-nueva-2027'

/** Dirección de la libreta como la manda la tienda. */
const HOME = {
  label: 'Casa',
  street: 'Av. Rivadavia',
  number: '4321',
  apartment: null,
  postalCode: '1406',
  city: 'Buenos Aires',
  province: 'CABA',
  isDefault: true,
} as const

/** `Set-Cookie` exacto de una sesión de cliente nueva (id de 64 hex, 30 días). */
const CUSTOMER_COOKIE =
  /^__Host-galpon_session=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/

describe('autenticación de la tienda y del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const mailer = new RecordingMailer()
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  /** Navegador de la cuenta principal (registro → libreta → logout). */
  const browser = newJar()
  /** Segundo navegador con la sesión iniciada (lo cierra el reset de contraseña). */
  const second = newJar()
  /** Navegador del admin. */
  const admin = newJar()

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ mailer })
    await seed(app.get(PrismaService))
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

  /** `call` de `test/support/http.ts` contra esta app. */
  function call(
    jar: Jar,
    method: HttpMethod,
    path: string,
    options?: CallOptions,
  ): Promise<request.Response> {
    return httpCall(server(), jar, method, path, options)
  }

  /** `refreshCsrf` de `test/support/http.ts` contra esta app. */
  function refreshCsrf(jar: Jar): Promise<request.Response> {
    return httpRefreshCsrf(server(), jar)
  }

  describe('cliente: CSRF, registro, cuenta, libreta y cierre de sesión', () => {
    let anonymous: Jar

    it('GET /auth/csrf sin cookie → 200 y una sesión anónima de 24 h', async () => {
      const response = await refreshCsrf(browser)

      expect(browser.csrf).toMatch(/^[0-9a-f]{64}$/)
      expect(setCookies(response)).toEqual([
        expect.stringMatching(
          /^__Host-galpon_session=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400$/,
        ),
      ])
      anonymous = { ...browser }
    })

    it('POST /auth/register → 201, cookie exacta de 30 días y la sesión anónima deja de valer', async () => {
      const response = await call(browser, 'post', '/auth/register', {
        body: { email: ' Ana@Mail.com ', firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
      })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({
        email: 'ana@mail.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        phone: null,
      })
      expect(setCookies(response)).toEqual([expect.stringMatching(CUSTOMER_COOKIE)])
      expect(browser.cookie).not.toBe(anonymous.cookie)

      // La cookie y el token anónimos ya no sirven; tampoco el token viejo con la cookie nueva.
      const oldSession = await call(anonymous, 'post', '/auth/password/forgot', {
        body: { email: 'ana@mail.com' },
      })
      const oldToken = await call(browser, 'post', '/auth/password/forgot', {
        body: { email: 'ana@mail.com' },
      })
      expect(oldSession.status).toBe(403)
      expect(oldSession.body).toMatchObject({ type: 'csrf_invalid' })
      expect(oldToken.status).toBe(403)
      expect(oldToken.body).toMatchObject({ type: 'csrf_invalid' })
    })

    it('GET /auth/csrf con la cookie nueva → otro token, sin cookie nueva', async () => {
      const response = await refreshCsrf(browser)

      expect(browser.csrf).not.toBe(anonymous.csrf)
      expect(setCookies(response)).toEqual([])
    })

    it('GET /me y PATCH /me con el teléfono', async () => {
      const me = await call(browser, 'get', '/me')
      const updated = await call(browser, 'patch', '/me', { body: { phone: '1123456789' } })

      expect(me.status).toBe(200)
      expect(me.body).toMatchObject({ email: 'ana@mail.com', phone: null })
      expect(updated.status).toBe(200)
      expect(updated.body).toEqual({
        email: 'ana@mail.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        phone: '1123456789',
      })
    })

    it('libreta: una sola predeterminada, reemplazo y borrado', async () => {
      const first = await call(browser, 'post', '/me/addresses', {
        body: { ...HOME, number: 's/n', postalCode: 'b1406' },
      })
      const second = await call(browser, 'post', '/me/addresses', {
        body: { ...HOME, label: 'Trabajo', street: 'Av. Corrientes', number: '1234' },
      })
      const list = await call(browser, 'get', '/me/addresses')

      expect(first.status).toBe(201)
      expect(first.body).toMatchObject({ number: 'S/N', postalCode: 'B1406', apartment: null })
      expect(second.status).toBe(201)
      const firstId = (first.body as { id: string }).id
      const secondId = (second.body as { id: string }).id
      expect(list.status).toBe(200)
      expect(list.body).toEqual([
        { ...HOME, label: 'Trabajo', street: 'Av. Corrientes', number: '1234', id: secondId },
        { ...HOME, number: 'S/N', postalCode: 'B1406', isDefault: false, id: firstId },
      ])

      const replaced = await call(browser, 'patch', `/me/addresses/${firstId}`, {
        body: { ...HOME, apartment: '5° B', label: null },
      })
      const removed = await call(browser, 'delete', `/me/addresses/${secondId}`)
      const missing = await call(browser, 'delete', '/me/addresses/adr-0001')
      const after = await call(browser, 'get', '/me/addresses')

      expect(replaced.status).toBe(200)
      expect(replaced.body).toEqual({ ...HOME, apartment: '5° B', label: null, id: firstId })
      expect(removed.status).toBe(204)
      expect(missing.status).toBe(404)
      expect(missing.body).toMatchObject({ detail: 'No existe esa dirección en tu libreta.' })
      expect(after.body).toEqual([{ ...HOME, apartment: '5° B', label: null, id: firstId }])
    })

    it('GET /me/orders → página vacía hasta B4', async () => {
      const response = await call(browser, 'get', '/me/orders')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ items: [], page: 1, pageSize: 10, total: 0 })
    })

    it('POST /auth/logout → 204, cookie borrada y GET /me después → 401', async () => {
      const closed = { ...browser }

      const response = await call(browser, 'post', '/auth/logout')
      const me = await call(closed, 'get', '/me')

      expect(response.status).toBe(204)
      expect(setCookies(response)).toEqual([
        '__Host-galpon_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      ])
      expect(browser.cookie).toBeNull()
      expect(me.status).toBe(401)
      expect(me.body).toMatchObject({ type: 'unauthorized', status: 401 })
    })
  })

  describe('inicio de sesión del cliente', () => {
    it('con el email con mayúsculas y espacios → 200 y una sesión nueva', async () => {
      await refreshCsrf(second)

      const response = await call(second, 'post', '/auth/login', {
        body: { email: ' ANA@Mail.com ', password: PASSWORD },
      })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ email: 'ana@mail.com', phone: '1123456789' })
      expect(setCookies(response)).toEqual([expect.stringMatching(CUSTOMER_COOKIE)])
      await refreshCsrf(second)
      expect((await call(second, 'get', '/me')).status).toBe(200)
    })

    it('con la contraseña mal → 401 invalid_credentials sin decir qué falló', async () => {
      const response = await call(second, 'post', '/auth/login', {
        body: { email: 'ana@mail.com', password: 'otra-cosa-2026' },
      })

      expect(response.status).toBe(401)
      expect(response.headers['content-type']).toContain('application/problem+json')
      expect(response.body).toMatchObject({
        type: 'invalid_credentials',
        title: 'Credenciales incorrectas',
        detail: 'Email o contraseña incorrectos.',
      })
    })

    it('diez fallos seguidos del mismo email → 429 rate_limited con Retry-After', async () => {
      const jar = newJar()
      await refreshCsrf(jar)
      const attempt = () =>
        call(jar, 'post', '/auth/login', {
          body: { email: 'nadie@mail.com', password: 'no-existe-2026' },
        })

      for (let failure = 1; failure < 10; failure++) {
        expect((await attempt()).status).toBe(401)
      }
      const locked = await attempt()

      expect(locked.status).toBe(429)
      expect(locked.body).toMatchObject({ type: 'rate_limited', status: 429 })
      const retryAfter = Number(locked.headers['retry-after'])
      expect(Number.isInteger(retryAfter)).toBe(true)
      expect(retryAfter).toBeGreaterThanOrEqual(1)
    })

    it('registrarse de nuevo con ANA@mail.com → 409 email_already_registered', async () => {
      const jar = newJar()
      await refreshCsrf(jar)

      const response = await call(jar, 'post', '/auth/register', {
        body: { email: 'ANA@mail.com', firstName: 'Ana', lastName: 'Otra', password: PASSWORD },
      })

      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({
        type: 'email_already_registered',
        title: 'El email ya tiene una cuenta',
        detail: 'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.',
      })
    })
  })

  describe('recuperación de la contraseña', () => {
    const jar = newJar()
    let link = ''

    it('forgot → 202 siempre; con el email conocido manda el link de la tienda', async () => {
      await refreshCsrf(jar)
      const sentBefore = mailer.passwordResets.length

      const unknown = await call(jar, 'post', '/auth/password/forgot', {
        body: { email: 'nadie@mail.com' },
      })
      expect(unknown.status).toBe(202)
      expect(mailer.passwordResets).toHaveLength(sentBefore)

      const known = await call(jar, 'post', '/auth/password/forgot', {
        body: { email: ' Ana@mail.com' },
      })
      expect(known.status).toBe(202)
      expect(known.text).toBe('')
      expect(mailer.passwordResets).toHaveLength(sentBefore + 1)
      link = mailer.passwordResets.at(-1)?.link ?? ''
      expect(link.startsWith('http://localhost:3000/cuenta/restablecer?token=rt_')).toBe(true)
    })

    it('reset → 204, cierra las sesiones abiertas y el token no se puede volver a usar', async () => {
      const token = new URL(link).searchParams.get('token') ?? ''

      const done = await call(jar, 'post', '/auth/password/reset', {
        body: { token, password: NEW_PASSWORD },
      })
      const openSession = await call(second, 'get', '/me')
      const again = await call(jar, 'post', '/auth/password/reset', {
        body: { token, password: NEW_PASSWORD },
      })

      expect(done.status).toBe(204)
      expect(openSession.status).toBe(401)
      expect(again.status).toBe(422)
      expect(firstError(again)).toMatchObject({ field: 'token', code: 'invalid_token' })
    })

    it('la contraseña vieja ya no entra y la nueva sí', async () => {
      const old = await call(jar, 'post', '/auth/login', {
        body: { email: 'ana@mail.com', password: PASSWORD },
      })
      const fresh = await call(jar, 'post', '/auth/login', {
        body: { email: 'ana@mail.com', password: NEW_PASSWORD },
      })

      expect(old.status).toBe(401)
      expect(fresh.status).toBe(200)
      await refreshCsrf(jar)
      expect((await call(jar, 'get', '/me')).status).toBe(200)
    })
  })

  describe('dashboard', () => {
    it('POST /admin/auth/login con el admin semilla → 200, CSRF, vencimiento y cookie de 8 h', async () => {
      const response = await call(admin, 'post', '/admin/auth/login', { body: SEED_ADMIN })

      expect(response.status).toBe(200)
      const body = response.body as { email: string; csrfToken: string; expiresAt: string }
      expect(body.email).toBe('admin@galponmates.com.ar')
      expect(body.csrfToken).toMatch(/^[0-9a-f]{64}$/)
      expect(Math.abs(Date.parse(body.expiresAt) - (Date.now() + 8 * 3600 * 1000))).toBeLessThan(
        60_000,
      )
      expect(setCookies(response)).toEqual([
        expect.stringMatching(
          /^__Host-galpon_admin=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800$/,
        ),
      ])
      admin.csrf = body.csrfToken
    })

    it('GET /admin/auth/me y /admin/auth/csrf con la sesión', async () => {
      const me = await call(admin, 'get', '/admin/auth/me')
      const csrf = await call(admin, 'get', '/admin/auth/csrf')

      expect(me.status).toBe(200)
      expect(me.body).toEqual({
        email: 'admin@galponmates.com.ar',
        expiresAt: expect.any(String) as unknown,
      })
      expect(csrf.status).toBe(200)
      expect(csrf.body).toEqual({ csrfToken: admin.csrf })
    })

    it('POST /admin/auth/password: sin CSRF 403, la actual mal 422, bien 204 y la sesión sigue', async () => {
      const change = {
        currentPassword: SEED_ADMIN.password,
        newPassword: NEW_ADMIN_PASSWORD,
        confirmation: NEW_ADMIN_PASSWORD,
      }

      const noCsrf = await call(admin, 'post', '/admin/auth/password', {
        body: change,
        csrf: false,
      })
      const wrong = await call(admin, 'post', '/admin/auth/password', {
        body: { ...change, currentPassword: 'no-es-esta-2026' },
      })
      const done = await call(admin, 'post', '/admin/auth/password', { body: change })
      const me = await call(admin, 'get', '/admin/auth/me')

      expect(noCsrf.status).toBe(403)
      expect(noCsrf.body).toMatchObject({ type: 'csrf_invalid' })
      expect(wrong.status).toBe(422)
      expect(firstError(wrong)).toMatchObject({
        field: 'currentPassword',
        message: 'La contraseña actual no es correcta',
      })
      expect(done.status).toBe(204)
      expect(me.status).toBe(200)
    })

    it('POST /admin/auth/logout → 204 y después /admin/auth/me → 401', async () => {
      const closed = { ...admin }

      const response = await call(admin, 'post', '/admin/auth/logout')
      const me = await call(closed, 'get', '/admin/auth/me')

      expect(response.status).toBe(204)
      expect(setCookies(response)).toEqual([
        '__Host-galpon_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      ])
      expect(me.status).toBe(401)
    })

    it('la cuenta del admin no inicia sesión en la tienda (401)', async () => {
      const jar = newJar()
      await refreshCsrf(jar)

      const response = await call(jar, 'post', '/auth/login', {
        body: { email: SEED_ADMIN.email, password: NEW_ADMIN_PASSWORD },
      })

      expect(response.status).toBe(401)
      expect(response.body).toMatchObject({ type: 'invalid_credentials' })
    })
  })

  describe('sin Redis', () => {
    it('las rutas con sesión responden 503 service_unavailable (falla cerrada)', async () => {
      const jar = newJar()
      await refreshCsrf(jar)
      await call(jar, 'post', '/auth/login', {
        body: { email: 'ana@mail.com', password: NEW_PASSWORD },
      })
      expect(jar.cookie).toMatch(/^__Host-galpon_session=[0-9a-f]{64}$/)

      await containers?.stopRedis()
      const me = await call(jar, 'get', '/me')
      const csrf = await call(newJar(), 'get', '/auth/csrf')

      expect(me.status).toBe(503)
      expect(me.body).toMatchObject({ type: 'service_unavailable', status: 503 })
      expect(csrf.status).toBe(503)
    })
  })
})
