import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type INestApplication,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { IsString, MinLength } from 'class-validator'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import {
  ADMIN_SESSION_COOKIE,
  CUSTOMER_SESSION_COOKIE,
} from '../../../shared/infrastructure/auth/cookies'
import {
  AdminSessionGuard,
  CustomerSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { AdminWriteAuditor } from '../application/admin-write-auditor'
import type {
  AuditLogRepository,
  NewAuditEntry,
} from '../application/ports/audit-log.repository.port'
import type { SnapshotSource } from '../domain/admin-write'
import type { JsonRow } from '../domain/audit-changes'
import { AuditInterceptor } from './audit.interceptor'

const ADMIN_USER = '0190a1b2-c3d4-7e5f-8a9b-000000000001'
const CATEGORY_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const CREATED_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'
const MISSING_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d'

/** Lo que pasó en un pedido, en orden: lecturas, handler y guardado. */
const events: string[] = []

/** Categorías en memoria: las modifican los handlers y las lee la auditoría. */
const categories = new Map<string, JsonRow>()

/** Base en memoria de la auditoría, con fallas programables. */
class FakeAuditLog implements AuditLogRepository {
  readonly entries: NewAuditEntry[] = []
  failReads = false
  failAppend = false
  /** Demora del guardado, para ver que la respuesta lo espera. */
  appendDelayMs = 0

  readRow(source: SnapshotSource, id: string): Promise<JsonRow | null> {
    events.push(`read ${source.table}`)
    if (this.failReads) return Promise.reject(new Error('La base no responde'))
    return Promise.resolve(source.table === 'categories' ? (categories.get(id) ?? null) : null)
  }

  async append(entry: NewAuditEntry): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.appendDelayMs))
    if (this.failAppend) throw new Error('La base no responde')
    events.push('append')
    this.entries.push(entry)
  }
}

/** Cuerpo de una categoría de prueba. */
class NameDto {
  /** Nombre. */
  @MinLength(1, { message: 'Requerido' })
  @IsString({ message: 'Requerido' })
  name = ''
}

/** Rutas con la misma forma que las líneas del dashboard. */
@Controller('admin/categories')
class TestCategoriesController {
  /** @returns Las categorías. */
  @Get()
  @UseGuards(AdminSessionGuard)
  list(): JsonRow[] {
    events.push('handler')
    return [...categories.values()]
  }

  /** @returns La categoría creada. */
  @Post()
  @UseGuards(AdminSessionGuard)
  create(@Body() body: NameDto): JsonRow {
    events.push('handler')
    const row = { id: CREATED_ID, name: body.name, updated_at: 'ahora' }
    categories.set(CREATED_ID, row)
    return row
  }

  /** Reordena. */
  @Put('order')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  reorder(): void {
    events.push('handler')
  }

  /**
   * @returns La categoría modificada.
   * @throws {NotFoundException} Si no existe.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard)
  update(@Param('id') id: string, @Body() body: NameDto): JsonRow {
    events.push('handler')
    const current = categories.get(id)
    if (current === undefined) throw new NotFoundException('No existe esa línea.')
    const row = { ...current, name: body.name, updated_at: 'después' }
    categories.set(id, row)
    return row
  }

  /** Borra. */
  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  remove(@Param('id') id: string): void {
    events.push('handler')
    categories.delete(id)
  }
}

/** Rutas de la sesión del admin y una ruta raíz (`@Put()`). */
@Controller('admin')
class TestAdminController {
  /** Cierra la sesión (no se audita). */
  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  logout(): void {
    events.push('handler')
  }

  /** Cambia la contraseña (se audita sin contenido). */
  @Post('auth/password')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  password(): void {
    events.push('handler')
  }

  /** @returns Un cupón deshabilitado: una ruta que la tabla de descriptores no conoce. */
  @Post('coupons/:couponId/disable')
  @UseGuards(AdminSessionGuard)
  disableCoupon(): object {
    events.push('handler')
    return { ok: true }
  }

  /** @returns Algo, sin guard: no hay sesión en el pedido. */
  @Post('open')
  open(): object {
    events.push('handler')
    return { ok: true }
  }

  /** @returns Algo, con la sesión de un cliente (un guard mal puesto). */
  @Post('wrong-guard')
  @UseGuards(CustomerSessionGuard)
  wrongGuard(): object {
    events.push('handler')
    return { ok: true }
  }
}

/** Ajustes: la ruta es la del controlador, sin nada más. */
@Controller('admin/settings')
class TestSettingsController {
  /** @returns Los ajustes. */
  @Put()
  @UseGuards(AdminSessionGuard)
  save(): object {
    events.push('handler')
    return { ok: true }
  }
}

/** Una escritura de la tienda, con la sesión de un cliente. */
@Controller('me')
class TestMeController {
  /** @returns El perfil. */
  @Patch()
  @UseGuards(CustomerSessionGuard)
  update(): object {
    events.push('handler')
    return { ok: true }
  }
}

describe('AuditInterceptor (HTTP con la auditoría en memoria)', () => {
  const sessions = new InMemorySessionStore()
  const errors: string[] = []
  let auditLog = new FakeAuditLog()
  let app: INestApplication<Server> | undefined
  let admin: SessionRecord
  let customer: SessionRecord

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [
        TestCategoriesController,
        TestAdminController,
        TestSettingsController,
        TestMeController,
      ],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        {
          provide: AdminWriteAuditor,
          // El repositorio se cambia en cada test: el auditor lo busca en cada llamada.
          useFactory: () =>
            new AdminWriteAuditor(
              {
                readRow: (source, id) => auditLog.readRow(source, id),
                append: (entry) => auditLog.append(entry),
              },
              { error: (message) => errors.push(message) },
            ),
        },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
    admin = await sessions.create({ kind: 'admin', userId: ADMIN_USER, customerId: null })
    customer = await sessions.create({ kind: 'customer', userId: 'user-2', customerId: 'cus-2' })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    events.length = 0
    errors.length = 0
    auditLog = new FakeAuditLog()
    categories.clear()
    categories.set(CATEGORY_ID, { id: CATEGORY_ID, name: 'Imperiales', updated_at: 'antes' })
  })

  function agent() {
    if (app === undefined) throw new Error('La app no arrancó')
    return request(app.getHttpServer())
  }

  const adminCookie = (): string => `${ADMIN_SESSION_COOKIE}=${admin.id}`
  const customerCookie = (): string => `${CUSTOMER_SESSION_COOKIE}=${customer.id}`

  it('una edición del admin deja una fila: lee antes, corre el handler, lee después y guarda', async () => {
    const response = await agent()
      .patch(`/admin/categories/${CATEGORY_ID}`)
      .set('Cookie', adminCookie())
      .send({ name: 'Torpedos' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: CATEGORY_ID, name: 'Torpedos', updated_at: 'después' })
    expect(events).toEqual(['read categories', 'handler', 'read categories', 'append'])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN_USER,
        action: 'category.update',
        entityType: 'category',
        entityId: CATEGORY_ID,
        changes: {
          input: { name: 'Torpedos' },
          before: { name: 'Imperiales' },
          after: { name: 'Torpedos' },
        },
      },
    ])
    expect(errors).toEqual([])
  })

  it('la respuesta espera a que la fila esté guardada', async () => {
    auditLog.appendDelayMs = 40

    const response = await agent()
      .patch(`/admin/categories/${CATEGORY_ID}`)
      .set('Cookie', adminCookie())
      .send({ name: 'Torpedos' })

    expect(response.status).toBe(200)
    expect(auditLog.entries).toHaveLength(1)
  })

  it('un alta toma el id de la respuesta y guarda la fila entera', async () => {
    const response = await agent()
      .post('/admin/categories')
      .set('Cookie', adminCookie())
      .send({ name: 'Camioneros' })

    expect(response.status).toBe(201)
    expect(events).toEqual(['handler', 'read categories', 'append'])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN_USER,
        action: 'category.create',
        entityType: 'category',
        entityId: CREATED_ID,
        changes: {
          input: { name: 'Camioneros' },
          before: null,
          after: { id: CREATED_ID, name: 'Camioneros', updated_at: 'ahora' },
        },
      },
    ])
  })

  it('un borrado (204 sin cuerpo) guarda la fila de antes y no tiene input', async () => {
    const response = await agent()
      .delete(`/admin/categories/${CATEGORY_ID}`)
      .set('Cookie', adminCookie())

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN_USER,
        action: 'category.delete',
        entityType: 'category',
        entityId: CATEGORY_ID,
        changes: {
          before: { id: CATEGORY_ID, name: 'Imperiales', updated_at: 'antes' },
          after: null,
        },
      },
    ])
  })

  it('reordenar y los ajustes: la ruta sale del controlador y del handler', async () => {
    await agent()
      .put('/admin/categories/order')
      .set('Cookie', adminCookie())
      .send({ ids: ['b', 'a'] })
    await agent().put('/admin/settings').set('Cookie', adminCookie()).send({ kit: 10 })

    expect(auditLog.entries.map((entry) => [entry.action, entry.entityId, entry.changes])).toEqual([
      ['category.reorder', null, { input: { ids: ['b', 'a'] } }],
      ['settings.update', '1', { input: { kit: 10 } }],
    ])
  })

  it('el cambio de contraseña queda sin contenido y el cierre de sesión no se audita', async () => {
    const password = await agent()
      .post('/admin/auth/password')
      .set('Cookie', adminCookie())
      .send({ currentPassword: 'vieja-123456', newPassword: 'nueva-123456' })
    const logout = await agent().post('/admin/auth/logout').set('Cookie', adminCookie())

    expect([password.status, logout.status]).toEqual([204, 204])
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN_USER,
        action: 'admin_user.password',
        entityType: 'admin_user',
        entityId: ADMIN_USER,
        changes: {},
      },
    ])
  })

  it('una escritura de admin/ que la tabla no conoce se audita igual, con lo que mandó', async () => {
    const response = await agent()
      .post('/admin/coupons/cup-1/disable')
      .set('Cookie', adminCookie())
      .send({ reason: 'vencido' })

    expect(response.status).toBe(201)
    expect(auditLog.entries).toEqual([
      {
        actorUserId: ADMIN_USER,
        action: 'coupons.disable',
        entityType: 'coupons',
        entityId: 'cup-1',
        changes: { input: { reason: 'vencido' } },
      },
    ])
  })

  it('un handler que falla (404) o un cuerpo inválido (422) no dejan fila', async () => {
    const missing = await agent()
      .patch(`/admin/categories/${MISSING_ID}`)
      .set('Cookie', adminCookie())
      .send({ name: 'Torpedos' })
    const invalid = await agent()
      .patch(`/admin/categories/${CATEGORY_ID}`)
      .set('Cookie', adminCookie())
      .send({ name: '' })

    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ detail: 'No existe esa línea.' })
    expect(invalid.status).toBe(422)
    expect(auditLog.entries).toEqual([])
    expect(events).not.toContain('append')
    expect(errors).toEqual([])
  })

  it('una lectura del admin no se audita ni lee nada de más', async () => {
    const response = await agent().get('/admin/categories').set('Cookie', adminCookie())

    expect(response.status).toBe(200)
    expect(events).toEqual(['handler'])
    expect(auditLog.entries).toEqual([])
  })

  it('sin sesión de admin no hay auditoría: 401 del guard, ruta sin guard o sesión de cliente', async () => {
    const unauthorized = await agent().post('/admin/categories').send({ name: 'X' })
    const open = await agent().post('/admin/open').set('Cookie', adminCookie()).send({ a: 1 })
    const wrongGuard = await agent()
      .post('/admin/wrong-guard')
      .set('Cookie', customerCookie())
      .send({ a: 1 })
    const store = await agent().patch('/me').set('Cookie', customerCookie()).send({ a: 1 })

    expect([unauthorized.status, open.status, wrongGuard.status, store.status]).toEqual([
      401, 201, 201, 200,
    ])
    expect(events).toEqual(['handler', 'handler', 'handler'])
    expect(auditLog.entries).toEqual([])
  })

  describe('si la auditoría falla, la respuesta del admin no cambia', () => {
    it('falla el guardado: 200 con el mismo cuerpo, la escritura queda hecha y hay un error en el log', async () => {
      auditLog.failAppend = true

      const response = await agent()
        .patch(`/admin/categories/${CATEGORY_ID}`)
        .set('Cookie', adminCookie())
        .send({ name: 'Torpedos' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ id: CATEGORY_ID, name: 'Torpedos', updated_at: 'después' })
      expect(categories.get(CATEGORY_ID)).toMatchObject({ name: 'Torpedos' })
      expect(auditLog.entries).toEqual([])
      expect(errors).toEqual([
        `No se pudo guardar la auditoría de category.update (category ${CATEGORY_ID}): Error`,
      ])
    })

    it('fallan las lecturas: 200, la fila se guarda sin la foto y hay un error en el log', async () => {
      auditLog.failReads = true

      const response = await agent()
        .patch(`/admin/categories/${CATEGORY_ID}`)
        .set('Cookie', adminCookie())
        .send({ name: 'Torpedos' })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ name: 'Torpedos' })
      expect(auditLog.entries.map((entry) => entry.changes)).toEqual([
        { input: { name: 'Torpedos' } },
      ])
      expect(errors).toEqual([
        `No se pudo leer la fila de antes para la auditoría de category.update (category ${CATEGORY_ID}): Error`,
      ])
    })
  })
})
