import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import { err, ok } from '../../../shared/domain/result'
import { ADMIN_SESSION_COOKIE } from '../../../shared/infrastructure/auth/cookies'
import { AdminLoginCommand } from '../application/commands/admin-login.command'
import { ChangeAdminPasswordCommand } from '../application/commands/change-admin-password.command'
import { LogoutCommand } from '../application/commands/logout.command'
import { GetAdminSessionQuery } from '../application/queries/get-admin-session.query'
import { AdminAuthController } from './admin-auth.controller'

const ADMIN_EMAIL = 'admin@galponmates.com.ar'

/** Cambio de contraseña válido. */
const CHANGE = {
  currentPassword: 'galpon-demo-2026',
  newPassword: 'galpon-nueva-2027',
  confirmation: 'galpon-nueva-2027',
} as const

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

describe('AdminAuthController (HTTP con casos de uso simulados)', () => {
  const sessions = new InMemorySessionStore()
  const adminLogin = { execute: vi.fn() }
  const logout = { execute: vi.fn(() => Promise.resolve()) }
  const getSession = { execute: vi.fn() }
  const changePassword = { execute: vi.fn() }
  let app: INestApplication<Server> | undefined
  let session: SessionRecord

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [AdminAuthController],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        { provide: AdminLoginCommand, useValue: adminLogin },
        { provide: LogoutCommand, useValue: logout },
        { provide: GetAdminSessionQuery, useValue: getSession },
        { provide: ChangeAdminPasswordCommand, useValue: changePassword },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await sessions.create({ kind: 'admin', userId: 'admin-1', customerId: null })
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function cookie(): string {
    return `${ADMIN_SESSION_COOKIE}=${session.id}`
  }

  it('POST /admin/auth/login → 200 con email, csrfToken y expiresAt, y la cookie de 8 h', async () => {
    adminLogin.execute.mockResolvedValueOnce({ email: ADMIN_EMAIL, session })

    const response = await request(server())
      .post('/admin/auth/login')
      .send({ email: ' Admin@GalponMates.com.ar ', password: 'galpon-demo-2026' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      email: ADMIN_EMAIL,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    })
    expect(response.headers['set-cookie']).toEqual([
      `__Host-galpon_admin=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
    ])
    expect(adminLogin.execute).toHaveBeenCalledWith({
      email: ADMIN_EMAIL,
      password: 'galpon-demo-2026',
      clientIp: expect.any(String) as unknown,
    })
  })

  it('POST /admin/auth/login con el email inválido o sin contraseña → 422', async () => {
    const badEmail = await request(server())
      .post('/admin/auth/login')
      .send({ email: 'admin', password: 'x' })
    const noPassword = await request(server())
      .post('/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: '' })

    expect(firstError(badEmail)).toMatchObject({
      field: 'email',
      message: 'Ingresá un email válido',
    })
    expect(firstError(noPassword)).toMatchObject({ field: 'password', message: 'Requerido' })
    expect(adminLogin.execute).not.toHaveBeenCalled()
  })

  it('GET /admin/auth/me y /admin/auth/csrf con la sesión; sin ella → 401', async () => {
    getSession.execute.mockResolvedValueOnce({ email: ADMIN_EMAIL, expiresAt: session.expiresAt })

    const me = await request(server()).get('/admin/auth/me').set('Cookie', cookie())
    const csrf = await request(server()).get('/admin/auth/csrf').set('Cookie', cookie())
    const missing = await request(server()).get('/admin/auth/me')

    expect(me.status).toBe(200)
    expect(me.body).toEqual({ email: ADMIN_EMAIL, expiresAt: session.expiresAt })
    expect(getSession.execute).toHaveBeenCalledWith(session)
    expect(csrf.status).toBe(200)
    expect(csrf.body).toEqual({ csrfToken: session.csrfToken })
    expect(missing.status).toBe(401)
  })

  it('POST /admin/auth/password con la confirmación distinta → 422 en confirmation', async () => {
    const response = await request(server())
      .post('/admin/auth/password')
      .set('Cookie', cookie())
      .set('X-CSRF-Token', session.csrfToken)
      .send({ ...CHANGE, confirmation: 'otra-cosa-2027' })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      type: 'validation_error',
      errors: [{ field: 'confirmation', message: 'Las contraseñas no coinciden' }],
    })
    expect(changePassword.execute).not.toHaveBeenCalled()
  })

  it('POST /admin/auth/password con la actual mal → 422 en currentPassword; bien → 204', async () => {
    changePassword.execute
      .mockResolvedValueOnce(err('wrong_current_password'))
      .mockResolvedValueOnce(ok(undefined))
    const send = () =>
      request(server())
        .post('/admin/auth/password')
        .set('Cookie', cookie())
        .set('X-CSRF-Token', session.csrfToken)
        .send(CHANGE)

    const wrong = await send()
    const done = await send()

    expect(wrong.status).toBe(422)
    expect(firstError(wrong)).toMatchObject({
      field: 'currentPassword',
      code: 'invalid_password',
      message: 'La contraseña actual no es correcta',
    })
    expect(done.status).toBe(204)
    expect(changePassword.execute).toHaveBeenCalledWith(
      'admin-1',
      { currentPassword: CHANGE.currentPassword, newPassword: CHANGE.newPassword },
      session.id,
    )
  })

  it('POST /admin/auth/password con una contraseña nueva débil → 422 en newPassword', async () => {
    const response = await request(server())
      .post('/admin/auth/password')
      .set('Cookie', cookie())
      .set('X-CSRF-Token', session.csrfToken)
      .send({ ...CHANGE, newPassword: 'corta1', confirmation: 'corta1' })

    expect(firstError(response)).toMatchObject({
      field: 'newPassword',
      message: 'Mínimo 10 caracteres, con letras y números',
    })
  })

  it('POST /admin/auth/password sin X-CSRF-Token → 403 csrf_invalid', async () => {
    const response = await request(server())
      .post('/admin/auth/password')
      .set('Cookie', cookie())
      .send(CHANGE)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ type: 'csrf_invalid' })
  })

  it('POST /admin/auth/logout → 204 y borra la cookie del admin', async () => {
    const response = await request(server())
      .post('/admin/auth/logout')
      .set('Cookie', cookie())
      .set('X-CSRF-Token', session.csrfToken)

    expect(response.status).toBe(204)
    expect(response.headers['set-cookie']).toEqual([
      '__Host-galpon_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ])
    expect(logout.execute).toHaveBeenCalledWith(session.id)
  })
})
