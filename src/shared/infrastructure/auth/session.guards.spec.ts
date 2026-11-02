import { Controller, Get, HttpCode, type INestApplication, Post, UseGuards } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { InMemorySessionStore } from '../../../../test/support/session'
import {
  SESSION_PORT,
  type SessionKind,
  type SessionRecord,
} from '../../application/ports/session.port'
import { DomainError } from '../../domain/domain-error'
import { ADMIN_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE } from './cookies'
import { CurrentSession } from './current-session.decorator'
import {
  AdminCsrfGuard,
  AdminSessionGuard,
  CustomerCsrfGuard,
  CustomerSessionGuard,
} from './session.guards'

/** Cuerpo de las rutas de prueba: lo que dejó el guard en el pedido. */
interface SessionEcho {
  session: { kind: SessionKind; userId: string | null }
}

function echo(session: SessionRecord): SessionEcho {
  return { session: { kind: session.kind, userId: session.userId } }
}

/** Una ruta por guard (y una con sesión + CSRF, como el logout). */
@Controller('guarded')
class GuardedController {
  @Get('customer')
  @UseGuards(CustomerSessionGuard)
  customer(@CurrentSession() session: SessionRecord): SessionEcho {
    return echo(session)
  }

  @Post('customer')
  @HttpCode(200)
  @UseGuards(CustomerCsrfGuard)
  customerWrite(@CurrentSession() session: SessionRecord): SessionEcho {
    return echo(session)
  }

  @Post('customer/logout')
  @HttpCode(200)
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  customerLogout(@CurrentSession() session: SessionRecord): SessionEcho {
    return echo(session)
  }

  @Get('admin')
  @UseGuards(AdminSessionGuard)
  admin(@CurrentSession() session: SessionRecord): SessionEcho {
    return echo(session)
  }

  @Post('admin')
  @HttpCode(200)
  @UseGuards(AdminCsrfGuard)
  adminWrite(@CurrentSession() session: SessionRecord): SessionEcho {
    return echo(session)
  }
}

const CSRF_PROBLEM = {
  type: 'csrf_invalid',
  title: 'Token CSRF inválido',
  status: 403,
  detail: 'El token CSRF falta o no es válido.',
}

describe('guards de sesión y CSRF', () => {
  const store = new InMemorySessionStore()
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [GuardedController],
      providers: [{ provide: SESSION_PORT, useValue: store }],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    store.sessions.clear()
    store.failWith = undefined
  })

  function server(): Server {
    if (!app) throw new Error('La app de prueba no se creó')
    return app.getHttpServer()
  }

  async function open(kind: SessionKind): Promise<SessionRecord> {
    return store.create({
      kind,
      userId: kind === 'anonymous' ? null : `user-${kind}`,
      customerId: kind === 'customer' ? 'customer-1' : null,
    })
  }

  describe('CustomerSessionGuard', () => {
    it('sin cookie responde 401 unauthorized "Sesión requerida"', async () => {
      const response = await request(server()).get('/guarded/customer')

      expect(response.status).toBe(401)
      expect(response.body).toMatchObject({
        type: 'unauthorized',
        title: 'Sesión requerida',
        detail: 'Iniciá sesión para continuar.',
      })
    })

    it('con una sesión anónima responde 401', async () => {
      const session = await open('anonymous')
      const response = await request(server())
        .get('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

      expect(response.status).toBe(401)
    })

    it('con una cookie que no corresponde a ninguna sesión responde 401', async () => {
      const response = await request(server())
        .get('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${'f'.repeat(64)}`)

      expect(response.status).toBe(401)
    })

    it('con una sesión de cliente deja pasar y @CurrentSession() la devuelve', async () => {
      const session = await open('customer')
      const response = await request(server())
        .get('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ session: { kind: 'customer', userId: 'user-customer' } })
    })

    it('falla cerrado: con el almacén caído responde 503 service_unavailable', async () => {
      const session = await open('customer')
      store.failWith = () =>
        new DomainError(
          'service_unavailable',
          503,
          'No pudimos verificar tu sesión. Probá de nuevo en un momento.',
        )
      const response = await request(server())
        .get('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({ type: 'service_unavailable', status: 503 })
    })
  })

  describe('CustomerCsrfGuard', () => {
    it('sin header responde 403 csrf_invalid', async () => {
      const session = await open('anonymous')
      const response = await request(server())
        .post('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject(CSRF_PROBLEM)
    })

    it('sin cookie responde 403 csrf_invalid aunque venga el header', async () => {
      const session = await open('anonymous')
      const response = await request(server())
        .post('/guarded/customer')
        .set('X-CSRF-Token', session.csrfToken)

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject(CSRF_PROBLEM)
    })

    it('con un header distinto responde 403', async () => {
      const session = await open('anonymous')
      const response = await request(server())
        .post('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
        .set('X-CSRF-Token', `${session.csrfToken.slice(0, -1)}0`)

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject(CSRF_PROBLEM)
    })

    it('con el header correcto deja pasar una sesión anónima o de cliente', async () => {
      for (const kind of ['anonymous', 'customer'] as const) {
        const session = await open(kind)
        const response = await request(server())
          .post('/guarded/customer')
          .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
          .set('X-CSRF-Token', session.csrfToken)

        expect(response.status).toBe(200)
        expect((response.body as SessionEcho).session.kind).toBe(kind)
      }
    })

    it('rechaza una sesión de admin puesta en la cookie del cliente', async () => {
      const session = await open('admin')
      const response = await request(server())
        .post('/guarded/customer')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
        .set('X-CSRF-Token', session.csrfToken)

      expect(response.status).toBe(403)
    })

    it('junto con CustomerSessionGuard exige sesión de cliente y CSRF (logout)', async () => {
      const anonymous = await open('anonymous')
      const customer = await open('customer')

      const withoutAccount = await request(server())
        .post('/guarded/customer/logout')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${anonymous.id}`)
        .set('X-CSRF-Token', anonymous.csrfToken)
      const withoutCsrf = await request(server())
        .post('/guarded/customer/logout')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${customer.id}`)
      const ok = await request(server())
        .post('/guarded/customer/logout')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${customer.id}`)
        .set('X-CSRF-Token', customer.csrfToken)

      expect(withoutAccount.status).toBe(401)
      expect(withoutCsrf.status).toBe(403)
      expect(ok.status).toBe(200)
    })
  })

  describe('AdminSessionGuard y AdminCsrfGuard', () => {
    it('la sesión de admin pasa con su cookie y su CSRF', async () => {
      const session = await open('admin')
      const read = await request(server())
        .get('/guarded/admin')
        .set('Cookie', `${ADMIN_SESSION_COOKIE}=${session.id}`)
      const write = await request(server())
        .post('/guarded/admin')
        .set('Cookie', `${ADMIN_SESSION_COOKIE}=${session.id}`)
        .set('X-CSRF-Token', session.csrfToken)

      expect(read.status).toBe(200)
      expect(write.status).toBe(200)
      expect((write.body as SessionEcho).session.kind).toBe('admin')
    })

    it('la cookie del cliente no sirve para el admin', async () => {
      const session = await open('admin')
      const response = await request(server())
        .get('/guarded/admin')
        .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

      expect(response.status).toBe(401)
    })

    it('AdminCsrfGuard con una sesión de cliente responde 403', async () => {
      const session = await open('customer')
      const response = await request(server())
        .post('/guarded/admin')
        .set('Cookie', `${ADMIN_SESSION_COOKIE}=${session.id}`)
        .set('X-CSRF-Token', session.csrfToken)

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject(CSRF_PROBLEM)
    })
  })
})
