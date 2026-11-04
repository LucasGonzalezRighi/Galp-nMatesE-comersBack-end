import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { readdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { join, resolve } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AdminCategoriesController } from '../../../modules/catalog/interface/admin-categories.controller'
import { AdminCombosController } from '../../../modules/catalog/interface/admin-combos.controller'
import { AdminProductsController } from '../../../modules/catalog/interface/admin-products.controller'
import { AdminContentController } from '../../../modules/content/interface/admin-content.controller'
import { AdminDashboardController } from '../../../modules/dashboard/interface/admin-dashboard.controller'
import { AdminMediaController } from '../../../modules/media/interface/admin-media.controller'
import { AdminOrdersController } from '../../../modules/orders/interface/admin-orders.controller'
import { AdminReviewsController } from '../../../modules/reviews/interface/admin-reviews.controller'
import { AdminSettingsController } from '../../../modules/settings/interface/admin-settings.controller'
import { AdminMessagesController } from '../../../modules/support/interface/admin-messages.controller'

/** Límite de la app de prueba: chico para no hacer cientos de pedidos (en producción son 120). */
const TEST_LIMIT = 2

/** Pedidos por ruta: más que {@link TEST_LIMIT}, así un límite activo se nota. */
const REQUESTS_PER_ROUTE = TEST_LIMIT + 3

/**
 * Una ruta de cada controlador del dashboard (`admin-*.controller.ts`, salvo el login de
 * `admin-auth`, que conserva su límite propio). Sin sesión, el guard de sesión responde 401;
 * el guard global de límites corre antes, así que un 429 diría que el controlador sí se limita.
 */
const DASHBOARD_ROUTES = [
  { file: 'admin-categories', method: 'get', path: '/admin/categories' },
  { file: 'admin-combos', method: 'get', path: '/admin/combos' },
  { file: 'admin-products', method: 'get', path: '/admin/products' },
  { file: 'admin-content', method: 'get', path: '/admin/content/home' },
  { file: 'admin-dashboard', method: 'get', path: '/admin/dashboard/summary' },
  { file: 'admin-media', method: 'post', path: '/admin/media/signature' },
  { file: 'admin-orders', method: 'get', path: '/admin/orders' },
  { file: 'admin-reviews', method: 'get', path: '/admin/reviews' },
  { file: 'admin-settings', method: 'get', path: '/admin/settings' },
  { file: 'admin-messages', method: 'get', path: '/admin/messages' },
] as const

/** Controladores del dashboard que no se limitan (el login de admin sí, aparte). */
const UNTHROTTLED_FILES_EXCEPT = new Set(['admin-auth'])

/** Raíz del repo, para listar los controladores de `src/modules/<módulo>/interface/`. */
const MODULES_DIR = resolve(__dirname, '../../../modules')

/** Nombres (sin `.controller.ts`) de todos los `admin-*.controller.ts` de los módulos. */
function adminControllerFiles(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((module) => {
      const dir = join(MODULES_DIR, module.name, 'interface')
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    })
    .filter((file) => file.startsWith('admin-') && file.endsWith('.controller.ts'))
    .map((file) => file.replace(/\.controller\.ts$/, ''))
    .sort()
}

/** Ruta de control con el límite global: prueba que el guard de la app de prueba sí limita. */
@Controller('limited-control')
class LimitedControlController {
  /** @returns Un objeto vacío. */
  @Get()
  read(): object {
    return {}
  }
}

describe('Dashboard fuera del límite global de pedidos por IP (Ruling B-27)', () => {
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    // Las dependencias de los controladores (casos de uso, sesiones) son dobles vacíos: sin cookie,
    // el guard de sesión responde 401 sin llamarlos.
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: TEST_LIMIT }] })],
      controllers: [
        AdminCategoriesController,
        AdminCombosController,
        AdminProductsController,
        AdminContentController,
        AdminDashboardController,
        AdminMediaController,
        AdminOrdersController,
        AdminReviewsController,
        AdminSettingsController,
        AdminMessagesController,
        LimitedControlController,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .useMocker(() => ({}))
      .compile()
    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false })
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  it('control: una ruta sin @SkipThrottle responde 429 al pasar el límite', async () => {
    const statuses: number[] = []
    for (let i = 0; i < REQUESTS_PER_ROUTE; i += 1) {
      statuses.push((await request(server()).get('/limited-control')).status)
    }

    expect(statuses).toEqual([200, 200, 429, 429, 429])
  })

  it('la lista cubre todos los controladores admin-* (salvo el login de admin-auth)', () => {
    const expected = adminControllerFiles().filter((file) => !UNTHROTTLED_FILES_EXCEPT.has(file))

    expect(DASHBOARD_ROUTES.map((route) => route.file).sort()).toEqual(expected)
  })

  it.each(DASHBOARD_ROUTES)('$method $path nunca responde 429 ($file)', async (route) => {
    const statuses: number[] = []
    for (let i = 0; i < REQUESTS_PER_ROUTE; i += 1) {
      statuses.push((await request(server())[route.method](route.path)).status)
    }

    expect(statuses).toEqual(Array<number>(REQUESTS_PER_ROUTE).fill(401))
  })
})
