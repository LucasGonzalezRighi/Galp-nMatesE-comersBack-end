import { Controller, Get, type INestApplication, UseGuards } from '@nestjs/common'
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
import { OptionalCustomerSessionGuard, OptionalSession } from './optional-session.guard'

/** Cuerpo de las rutas de prueba: el cliente de la sesión, o `null` si va como invitado. */
interface OptionalEcho {
  customerId: string | null
}

@Controller('optional')
class OptionalController {
  @Get()
  @UseGuards(OptionalCustomerSessionGuard)
  guarded(@OptionalSession() session: SessionRecord | null): OptionalEcho {
    return { customerId: session?.customerId ?? null }
  }

  @Get('unguarded')
  unguarded(@OptionalSession() session: SessionRecord | null): OptionalEcho {
    return { customerId: session?.customerId ?? null }
  }
}

describe('OptionalCustomerSessionGuard y @OptionalSession()', () => {
  const store = new InMemorySessionStore()
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [OptionalController],
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

  function get(path: string, cookie?: string): request.Test {
    const pending = request(server()).get(path)
    return cookie === undefined ? pending : pending.set('Cookie', cookie)
  }

  it('sin cookie deja pasar como invitado (null)', async () => {
    const response = await get('/optional')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ customerId: null })
  })

  it('con la sesión de un cliente la deja en @OptionalSession()', async () => {
    const session = await open('customer')
    const response = await get('/optional', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ customerId: 'customer-1' })
  })

  it('con una sesión anónima, una de admin o una cookie vencida sigue como invitado', async () => {
    const anonymous = await open('anonymous')
    const admin = await open('admin')

    const responses = await Promise.all([
      get('/optional', `${CUSTOMER_SESSION_COOKIE}=${anonymous.id}`),
      get('/optional', `${CUSTOMER_SESSION_COOKIE}=${admin.id}`),
      get('/optional', `${ADMIN_SESSION_COOKIE}=${admin.id}`),
      get('/optional', `${CUSTOMER_SESSION_COOKIE}=${'f'.repeat(64)}`),
    ])

    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ customerId: null })
    }
  })

  it('con cookie y el almacén caído responde 503 (falla cerrada)', async () => {
    const session = await open('customer')
    store.failWith = () =>
      new DomainError(
        'service_unavailable',
        503,
        'No pudimos verificar tu sesión. Probá de nuevo en un momento.',
      )

    const response = await get('/optional', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ type: 'service_unavailable', status: 503 })
  })

  it('sin cookie no consulta el almacén (aunque esté caído)', async () => {
    store.failWith = () => new DomainError('service_unavailable', 503, 'Caído.')

    const response = await get('/optional')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ customerId: null })
  })

  it('@OptionalSession() sin guard en la ruta devuelve null en vez de fallar', async () => {
    const session = await open('customer')
    const response = await get('/optional/unguarded', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ customerId: null })
  })
})
