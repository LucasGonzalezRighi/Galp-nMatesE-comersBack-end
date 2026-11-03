import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import { CUSTOMER_SESSION_COOKIE } from '../../../shared/infrastructure/auth/cookies'
import { CreateMyAddressCommand } from '../application/commands/create-my-address.command'
import { DeleteMyAddressCommand } from '../application/commands/delete-my-address.command'
import { UpdateMeCommand } from '../application/commands/update-me.command'
import { UpdateMyAddressCommand } from '../application/commands/update-my-address.command'
import { GetMeQuery } from '../application/queries/get-me.query'
import { ListMyAddressesQuery } from '../application/queries/list-my-addresses.query'
import type { AddressView, CustomerView } from '../application/read-models'
import { AddressNotFoundError } from '../domain/identity-errors'
import { MeController } from './me.controller'

const CUSTOMER_ID = 'customer-1'

const ANA: CustomerView = {
  email: 'ana@mail.com',
  firstName: 'Ana',
  lastName: 'Pérez',
  phone: null,
}

/** Dirección válida tal como la manda la tienda. */
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

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

describe('MeController (HTTP con casos de uso simulados)', () => {
  const sessions = new InMemorySessionStore()
  const getMe = { execute: vi.fn(() => Promise.resolve(ANA)) }
  const updateMe = { execute: vi.fn(() => Promise.resolve(ANA)) }
  const listAddresses = { execute: vi.fn(() => Promise.resolve([] as AddressView[])) }
  const createAddress = {
    execute: vi.fn((_customerId: string, input: Omit<AddressView, 'id'>) =>
      Promise.resolve({ id: 'adr-1', ...input }),
    ),
  }
  const updateAddress = {
    execute: vi.fn((_customerId: string, id: string, input: Omit<AddressView, 'id'>) =>
      Promise.resolve({ ...input, id }),
    ),
  }
  const deleteAddress = { execute: vi.fn(() => Promise.resolve()) }
  let app: INestApplication<Server> | undefined
  let session: SessionRecord

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [MeController],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        { provide: GetMeQuery, useValue: getMe },
        { provide: UpdateMeCommand, useValue: updateMe },
        { provide: ListMyAddressesQuery, useValue: listAddresses },
        { provide: CreateMyAddressCommand, useValue: createAddress },
        { provide: UpdateMyAddressCommand, useValue: updateAddress },
        { provide: DeleteMyAddressCommand, useValue: deleteAddress },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await sessions.create({ kind: 'customer', userId: 'user-1', customerId: CUSTOMER_ID })
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  /** Pedido de escritura con la cookie y el CSRF de la sesión del cliente. */
  function write(method: 'post' | 'patch' | 'delete', path: string): request.Test {
    return request(server())
      [method](path)
      .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
      .set('X-CSRF-Token', session.csrfToken)
  }

  function read(path: string): request.Test {
    return request(server()).get(path).set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
  }

  it('GET /me → 200 con los datos; sin sesión → 401 problem+json', async () => {
    const found = await read('/me')
    const missing = await request(server()).get('/me')

    expect(found.status).toBe(200)
    expect(found.body).toEqual(ANA)
    expect(missing.status).toBe(401)
    expect(missing.body).toMatchObject({ type: 'unauthorized', status: 401 })
  })

  it('PATCH /me con {} → 422 sin campo ("Mandá al menos un dato para cambiar.")', async () => {
    const response = await write('patch', '/me').send({})

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      type: 'validation_error',
      errors: [{ field: '', code: 'too_small', message: 'Mandá al menos un dato para cambiar.' }],
    })
    expect(updateMe.execute).not.toHaveBeenCalled()
  })

  it('PATCH /me con phone: null lo borra y pasa solo ese cambio', async () => {
    const response = await write('patch', '/me').send({ phone: null })

    expect(response.status).toBe(200)
    expect(updateMe.execute).toHaveBeenCalledWith(CUSTOMER_ID, {
      firstName: undefined,
      lastName: undefined,
      phone: null,
    })
  })

  it.each([
    [{ phone: '01123456789' }, 'phone', 'Ingresá el código de área y el número, sin 0 ni 15'],
    [{ phone: 1123456789 }, 'phone', 'Ingresá el código de área y el número, sin 0 ni 15'],
    [{ firstName: null }, 'firstName', 'Requerido'],
    [{ lastName: 'X' }, 'lastName', 'Ingresá al menos 2 letras'],
    [{ email: 'otro@mail.com' }, 'email', 'Este campo no está permitido.'],
  ])('PATCH /me con %j → 422 en %s', async (body, field, message) => {
    const response = await write('patch', '/me').send(body)

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject({ field, message })
    expect(updateMe.execute).not.toHaveBeenCalled()
  })

  it('PATCH /me sin X-CSRF-Token → 403 csrf_invalid', async () => {
    const response = await request(server())
      .patch('/me')
      .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`)
      .send({ phone: null })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ type: 'csrf_invalid' })
  })

  it('POST /me/addresses normaliza número y código postal en mayúsculas → 201', async () => {
    const response = await write('post', '/me/addresses').send({
      ...HOME,
      label: ' Casa ',
      street: ' Av. Rivadavia ',
      number: 's/n',
      postalCode: 'b1406',
    })

    expect(response.status).toBe(201)
    expect(createAddress.execute).toHaveBeenCalledWith(CUSTOMER_ID, {
      ...HOME,
      number: 'S/N',
      postalCode: 'B1406',
    })
    expect(response.body).toMatchObject({ id: 'adr-1', number: 'S/N', apartment: null })
  })

  it('POST /me/addresses sin label ni apartment los guarda como null', async () => {
    const response = await write('post', '/me/addresses').send({
      street: HOME.street,
      number: HOME.number,
      postalCode: HOME.postalCode,
      city: HOME.city,
      province: HOME.province,
      isDefault: HOME.isDefault,
    })

    expect(response.status).toBe(201)
    expect(createAddress.execute).toHaveBeenCalledWith(CUSTOMER_ID, {
      ...HOME,
      label: null,
      apartment: null,
    })
  })

  it.each([
    [{ isDefault: 'false' }, 'isDefault', 'invalid_type'],
    [{ isDefault: 1 }, 'isDefault', 'invalid_type'],
    [{ number: '12a' }, 'number', 'invalid_format'],
    [{ postalCode: '14' }, 'postalCode', 'invalid_format'],
    [{ province: 'Capital' }, 'province', 'invalid_value'],
    [{ street: 'A' }, 'street', 'too_small'],
    [{ city: 'c'.repeat(61) }, 'city', 'too_big'],
    [{ apartment: '12345678901' }, 'apartment', 'too_big'],
    [{ label: 'l'.repeat(31) }, 'label', 'too_big'],
  ])('POST /me/addresses con %j → 422 en %s (%s)', async (change, field, code) => {
    const response = await write('post', '/me/addresses').send({ ...HOME, ...change })

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject({ field, code })
    expect(createAddress.execute).not.toHaveBeenCalled()
  })

  it('los mensajes de la libreta son los del front', async () => {
    const response = await write('post', '/me/addresses').send({
      ...HOME,
      number: 'x',
      postalCode: 'x',
      province: 'x',
      street: '',
    })

    const messages = Object.fromEntries(
      (response.body as { errors: { field: string; message: string }[] }).errors.map(
        ({ field, message }) => [field, message],
      ),
    )
    expect(messages).toMatchObject({
      street: 'Requerido',
      number: 'Ingresá el número o S/N',
      postalCode: 'Código postal inválido',
      province: 'Elegí una provincia',
    })
  })

  it('GET /me/addresses → la lista del caso de uso', async () => {
    const response = await read('/me/addresses')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
    expect(listAddresses.execute).toHaveBeenCalledWith(CUSTOMER_ID)
  })

  it('PATCH /me/addresses/{id} reemplaza la dirección; 404 si no existe', async () => {
    const response = await write('patch', '/me/addresses/adr-1').send(HOME)
    updateAddress.execute.mockRejectedValueOnce(new AddressNotFoundError())
    const missing = await write('patch', '/me/addresses/otra').send(HOME)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ...HOME, id: 'adr-1' })
    expect(updateAddress.execute).toHaveBeenCalledWith(CUSTOMER_ID, 'adr-1', HOME)
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({
      type: 'not_found',
      detail: 'No existe esa dirección en tu libreta.',
    })
  })

  it('DELETE /me/addresses/{id} → 204', async () => {
    const response = await write('delete', '/me/addresses/adr-1')

    expect(response.status).toBe(204)
    expect(deleteAddress.execute).toHaveBeenCalledWith(CUSTOMER_ID, 'adr-1')
  })
})
