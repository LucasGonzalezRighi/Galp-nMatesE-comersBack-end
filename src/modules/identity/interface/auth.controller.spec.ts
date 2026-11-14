import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import { err, ok } from '../../../shared/domain/result'
import { CUSTOMER_SESSION_COOKIE } from '../../../shared/infrastructure/auth/cookies'
import { IssueCsrfTokenCommand } from '../application/commands/issue-csrf-token.command'
import { LoginCustomerCommand } from '../application/commands/login-customer.command'
import { LogoutCommand } from '../application/commands/logout.command'
import { RegisterCustomerCommand } from '../application/commands/register-customer.command'
import { RequestPasswordResetCommand } from '../application/commands/request-password-reset.command'
import { ResetPasswordCommand } from '../application/commands/reset-password.command'
import type { CustomerView } from '../application/read-models'
import { AuthController } from './auth.controller'

/** Cliente que devuelven el registro y el inicio de sesión simulados. */
const ANA: CustomerView = {
  email: 'ana@mail.com',
  firstName: 'Ana',
  lastName: 'Pérez',
  phone: null,
}

/** Contraseña nueva válida (letras y números, 10 o más caracteres). */
const PASSWORD = 'mate-con-yerba-2026'

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

/** `Set-Cookie` de la respuesta como lista. */
function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie']
  return Array.isArray(header) ? (header as string[]) : []
}

describe('AuthController (HTTP con casos de uso simulados)', () => {
  const sessions = new InMemorySessionStore()
  const register = { execute: vi.fn() }
  const login = { execute: vi.fn() }
  const logout = { execute: vi.fn(() => Promise.resolve()) }
  const forgot = { execute: vi.fn(() => Promise.resolve()) }
  const reset = { execute: vi.fn() }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [AuthController],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        { provide: IssueCsrfTokenCommand, useValue: new IssueCsrfTokenCommand(sessions) },
        { provide: RegisterCustomerCommand, useValue: register },
        { provide: LoginCustomerCommand, useValue: login },
        { provide: LogoutCommand, useValue: logout },
        { provide: RequestPasswordResetCommand, useValue: forgot },
        { provide: ResetPasswordCommand, useValue: reset },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sessions.sessions.clear()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function anonymous(): Promise<SessionRecord> {
    return sessions.create({ kind: 'anonymous', userId: null, customerId: null })
  }

  function customerSession(): Promise<SessionRecord> {
    return sessions.create({ kind: 'customer', userId: 'user-1', customerId: 'customer-1' })
  }

  function cookie(session: SessionRecord): string {
    return `${CUSTOMER_SESSION_COOKIE}=${session.id}`
  }

  it('GET /auth/csrf sin cookie abre una sesión anónima y manda su cookie de 30 minutos', async () => {
    const response = await request(server()).get('/auth/csrf')

    expect(response.status).toBe(200)
    const [created] = [...sessions.sessions.values()]
    expect(created?.kind).toBe('anonymous')
    expect(response.body).toEqual({ csrfToken: created?.csrfToken })
    expect(setCookies(response)).toEqual([
      `__Host-galpon_session=${created?.id ?? ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`,
    ])
  })

  it('GET /auth/csrf con una sesión vigente devuelve su token sin mandar cookie', async () => {
    const session = await customerSession()

    const response = await request(server()).get('/auth/csrf').set('Cookie', cookie(session))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ csrfToken: session.csrfToken })
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('POST /auth/register normaliza el email, rota la sesión y manda la cookie de 30 días', async () => {
    const anon = await anonymous()
    const next = await customerSession()
    register.execute.mockResolvedValueOnce({ customer: ANA, session: next })

    const response = await request(server())
      .post('/auth/register')
      .set('Cookie', cookie(anon))
      .set('X-CSRF-Token', anon.csrfToken)
      .send({ email: ' Ana@Mail.com ', firstName: ' Ana ', lastName: 'Pérez', password: PASSWORD })

    expect(response.status).toBe(201)
    expect(response.body).toEqual(ANA)
    expect(setCookies(response)).toEqual([
      `__Host-galpon_session=${next.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    ])
    expect(register.execute).toHaveBeenCalledWith(
      { email: 'ana@mail.com', firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
      anon.id,
    )
  })

  it.each([
    [{ firstName: 'A' }, 'firstName', 'Ingresá al menos 2 letras'],
    [{ firstName: '' }, 'firstName', 'Requerido'],
    [{ lastName: 'P3rez' }, 'lastName', 'Usá solo letras'],
    [{ lastName: 'a'.repeat(51) }, 'lastName', 'Máximo 50 caracteres'],
    [{ email: 'ana@' }, 'email', 'Ingresá un email válido'],
    [{ password: 'abcdefghij' }, 'password', 'Mínimo 10 caracteres, con letras y números'],
    [{ password: 'abc123' }, 'password', 'Mínimo 10 caracteres, con letras y números'],
    [{ password: `a1${'b'.repeat(127)}` }, 'password', 'Máximo 128 caracteres'],
  ])('POST /auth/register con %j → 422 en %s', async (change, field, message) => {
    const anon = await anonymous()

    const response = await request(server())
      .post('/auth/register')
      .set('Cookie', cookie(anon))
      .set('X-CSRF-Token', anon.csrfToken)
      .send({
        email: 'ana@mail.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        password: PASSWORD,
        ...change,
      })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ type: 'validation_error', status: 422 })
    expect(firstError(response)).toMatchObject({ field, message })
    expect(register.execute).not.toHaveBeenCalled()
  })

  it('POST /auth/register acepta nombres con acentos, apóstrofo y guion', async () => {
    const anon = await anonymous()
    register.execute.mockResolvedValueOnce({ customer: ANA, session: await customerSession() })

    const response = await request(server())
      .post('/auth/register')
      .set('Cookie', cookie(anon))
      .set('X-CSRF-Token', anon.csrfToken)
      .send({
        email: 'ana@mail.com',
        firstName: 'María José',
        lastName: "D'Alessandro-Núñez",
        password: PASSWORD,
      })

    expect(response.status).toBe(201)
  })

  it('POST /auth/login sin X-CSRF-Token → 403 csrf_invalid (antes de validar el cuerpo)', async () => {
    const anon = await anonymous()

    const response = await request(server())
      .post('/auth/login')
      .set('Cookie', cookie(anon))
      .send({ email: 'ana@mail.com', password: PASSWORD })

    expect(response.status).toBe(403)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toMatchObject({
      type: 'csrf_invalid',
      title: 'Token CSRF inválido',
      detail: 'El token CSRF falta o no es válido.',
    })
    expect(login.execute).not.toHaveBeenCalled()
  })

  it('POST /auth/login → 200 con el cliente y la cookie nueva; sin contraseña → 422 Requerido', async () => {
    const anon = await anonymous()
    const next = await customerSession()
    login.execute.mockResolvedValueOnce({ customer: ANA, session: next })

    const ok200 = await request(server())
      .post('/auth/login')
      .set('Cookie', cookie(anon))
      .set('X-CSRF-Token', anon.csrfToken)
      .send({ email: ' ANA@mail.com', password: 'cualquiera' })
    const empty = await request(server())
      .post('/auth/login')
      .set('Cookie', cookie(next))
      .set('X-CSRF-Token', next.csrfToken)
      .send({ email: 'ana@mail.com', password: '' })

    expect(ok200.status).toBe(200)
    expect(ok200.body).toEqual(ANA)
    expect(setCookies(ok200)[0]).toContain(`__Host-galpon_session=${next.id};`)
    expect(login.execute).toHaveBeenCalledWith(
      { email: 'ana@mail.com', password: 'cualquiera', clientIp: expect.any(String) as unknown },
      anon.id,
    )
    expect(empty.status).toBe(422)
    expect(firstError(empty)).toMatchObject({ field: 'password', message: 'Requerido' })
  })

  it('POST /auth/logout → 204, cierra la sesión y borra la cookie; sin sesión → 401', async () => {
    const session = await customerSession()

    const response = await request(server())
      .post('/auth/logout')
      .set('Cookie', cookie(session))
      .set('X-CSRF-Token', session.csrfToken)
    const anonymousLogout = await request(server()).post('/auth/logout')

    expect(response.status).toBe(204)
    expect(setCookies(response)).toEqual([
      '__Host-galpon_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ])
    expect(logout.execute).toHaveBeenCalledWith(session.id)
    expect(anonymousLogout.status).toBe(401)
  })

  it('POST /auth/password/forgot → 202 sin cuerpo, con el email normalizado', async () => {
    const anon = await anonymous()

    const response = await request(server())
      .post('/auth/password/forgot')
      .set('Cookie', cookie(anon))
      .set('X-CSRF-Token', anon.csrfToken)
      .send({ email: ' Ana@Mail.com' })

    expect(response.status).toBe(202)
    expect(response.text).toBe('')
    expect(forgot.execute).toHaveBeenCalledWith('ana@mail.com')
  })

  it('POST /auth/password/reset → 204, o 422 en token si no sirve', async () => {
    const anon = await anonymous()
    reset.execute.mockResolvedValueOnce(ok(undefined)).mockResolvedValueOnce(err('invalid_token'))
    const send = () =>
      request(server())
        .post('/auth/password/reset')
        .set('Cookie', cookie(anon))
        .set('X-CSRF-Token', anon.csrfToken)
        .send({ token: 'rt_abc', password: PASSWORD })

    const done = await send()
    const invalid = await send()

    expect(done.status).toBe(204)
    expect(reset.execute).toHaveBeenCalledWith({ token: 'rt_abc', password: PASSWORD })
    expect(invalid.status).toBe(422)
    expect(invalid.body).toMatchObject({
      type: 'validation_error',
      errors: [
        {
          field: 'token',
          code: 'invalid_token',
          message: 'El enlace para cambiar la contraseña no es válido o ya venció.',
        },
      ],
    })
  })
})
