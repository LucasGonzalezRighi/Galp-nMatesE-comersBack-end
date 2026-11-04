import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Server } from 'node:http'
import { resolve } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppModule } from '../../src/app.module'
import { setupApp } from '../../src/app.setup'
import { buildOpenApiDocument, setupSwagger } from '../../src/swagger'
import {
  type ContractDocument,
  diffOperation,
  diffPath,
  loadContract,
  normalizeOpenApi,
  type NormalizedContract,
  normalizeSecuritySchemes,
  type NormalizedSecurityScheme,
} from './normalize'

/**
 * Operaciones (`MÉTODO /ruta`, rutas relativas a `/api/v1`) que el back ya implementa: tienen que
 * coincidir con el contrato. Las demás operaciones del contrato se listan como pendientes.
 */
const IMPLEMENTED_PATHS: readonly string[] = [
  // B2: lecturas públicas del catálogo, contenidos, reseñas y ajustes.
  'GET /categories',
  'GET /products',
  'GET /products/{slug}',
  'GET /products/{slug}/related',
  'GET /products/{slug}/reviews',
  'GET /reviews/featured',
  'GET /content/home',
  'GET /content/about',
  'GET /content/faq',
  'GET /content/footer',
  'GET /content/product-tabs',
  'GET /content/legal/{document}',
  'GET /settings/public',
  // B3: identidad (sesión de la tienda, cuenta del cliente y sesión del dashboard).
  'GET /auth/csrf',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'GET /me',
  'PATCH /me',
  'GET /me/orders',
  'GET /me/addresses',
  'POST /me/addresses',
  'PATCH /me/addresses/{id}',
  'DELETE /me/addresses/{id}',
  'POST /admin/auth/login',
  'POST /admin/auth/logout',
  'GET /admin/auth/me',
  'GET /admin/auth/csrf',
  'POST /admin/auth/password',
  // B4: pedidos y stock (cotización del carrito y del envío, pedidos y "mis pedidos").
  'POST /cart/quote',
  'POST /shipping/quote',
  'POST /orders',
  'GET /orders/{number}',
  'GET /me/orders/{number}',
  // B5: pagos con Mercado Pago (preferencia, tarjeta, cuotas, cancelación y webhook).
  'POST /orders/{number}/payments/mercadopago/preference',
  'POST /orders/{number}/payments/mercadopago/card',
  'POST /orders/{number}/payments/mercadopago/installments',
  'POST /orders/{number}/cancel-payment',
  'POST /webhooks/mercadopago',
  // B5c: combos (la tienda y el dashboard).
  'GET /combos',
  'GET /admin/combos',
  'POST /admin/combos',
  'PUT /admin/combos/order',
  'PATCH /admin/combos/{id}',
  'DELETE /admin/combos/{id}',
]

/** Operaciones que Swagger genera y el contrato no tiene, a propósito. */
const EXTRA_OPERATIONS: readonly string[] = ['GET /health']

/** Contrato del front: `CONTRACT_PATH` o, por defecto, `../frontend/docs/api/openapi.yaml`. */
const CONTRACT_PATH = resolve(
  process.env.CONTRACT_PATH ?? resolve(__dirname, '../../../frontend/docs/api/openapi.yaml'),
)

/** Ruta que pide `scripts/openapi-diff.mjs` para imprimir su diff (vacía en los demás casos). */
const DIFF_PATH = process.env.OPENAPI_DIFF_PATH ?? ''

describe('normalizeOpenApi', () => {
  const base: ContractDocument = {
    openapi: '3.1.0',
    paths: {
      '/items/{slug}': {
        get: {
          operationId: 'getItem',
          tags: ['catalog'],
          summary: 'Obtener un ítem',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { $ref: '#/components/parameters/Page' },
          ],
          responses: {
            '200': {
              description: 'El ítem.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
            },
            '404': { description: 'No existe.' },
          },
        },
      },
    },
    components: {
      parameters: {
        Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, example: 2 } },
      },
      schemas: {
        Item: {
          type: 'object',
          required: ['name', 'description'],
          properties: {
            name: { type: 'string', description: 'Nombre.' },
            description: { type: ['string', 'null'] },
          },
          'x-internal': true,
        },
      },
    },
  }

  it('da lo mismo para dos documentos que solo cambian descripciones y el orden de las claves', () => {
    const reordered: ContractDocument = {
      components: {
        schemas: {
          Item: {
            properties: {
              description: { type: ['string', 'null'], description: 'Otra cosa.' },
              name: { description: 'Otro nombre.', type: 'string', example: 'Imperial' },
            },
            required: ['description', 'name'],
            type: 'object',
          },
        },
        parameters: {
          Page: { schema: { minimum: 1, type: 'integer' }, in: 'query', name: 'page' },
        },
      },
      paths: {
        '/items/{slug}': {
          get: {
            responses: {
              '404': { description: 'Nada.' },
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
                description: 'Otro texto.',
              },
            },
            parameters: [
              { $ref: '#/components/parameters/Page' },
              { schema: { type: 'string' }, required: true, in: 'path', name: 'slug' },
            ],
          },
        },
      },
      openapi: '3.1.0',
    }

    expect(normalizeOpenApi(reordered)).toEqual(normalizeOpenApi(base))
  })

  it('resuelve $ref a su nombre, aplana allOf de un elemento y conserva propiedades', () => {
    const normalized = normalizeOpenApi(base)
    const operation = normalized['GET /items/{slug}']

    expect(operation?.responses).toEqual(['200', '404'])
    expect(operation?.parameters).toEqual([
      { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { minimum: 1, type: 'integer' } },
    ])
    expect(operation?.success).toEqual({ '200': { 'application/json': { $ref: 'Item' } } })
    expect(operation?.schemas).toEqual({
      Item: {
        properties: { description: { type: ['null', 'string'] }, name: { type: 'string' } },
        required: ['description', 'name'],
        type: 'object',
      },
    })

    const wrapped: ContractDocument = {
      ...base,
      paths: {
        '/items/{slug}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { allOf: [{ $ref: '#/components/schemas/Item' }] },
                  },
                },
              },
              '404': {},
            },
          },
        },
      },
    }
    expect(normalizeOpenApi(wrapped)['GET /items/{slug}']?.success).toEqual(operation?.success)
  })

  it('muestra un diff legible cuando cambia el esquema o los códigos', () => {
    const changed: ContractDocument = {
      ...base,
      components: {
        ...base.components,
        schemas: { Item: { type: 'object', properties: { name: { type: 'integer' } } } },
      },
    }
    const key = 'GET /items/{slug}'
    const lines = diffOperation(key, normalizeOpenApi(base)[key], normalizeOpenApi(changed)[key])

    expect(lines).toContain(
      'GET /items/{slug} › esquema.Item.properties.name.type: contrato "string" · Swagger "integer"',
    )
    expect(lines.some((line) => line.includes('esquema.Item.required'))).toBe(true)
    expect(diffOperation(key, normalizeOpenApi(base)[key], undefined)).toEqual([
      'GET /items/{slug}: está en el contrato pero Swagger no la genera',
    ])
  })
})

describe('contrato OpenAPI', () => {
  let app: INestApplication<Server> | undefined
  let contract: NormalizedContract = {}
  let generated: NormalizedContract = {}
  let contractSchemes: Record<string, NormalizedSecurityScheme> = {}
  let generatedSchemes: Record<string, NormalizedSecurityScheme> = {}

  beforeAll(async () => {
    // Sin Docker: la app se arma sin `init()` (Prisma no consulta) y con URLs que no responden.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'postgresql://contract:contract@127.0.0.1:1/contract')
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1')
    app = await NestFactory.create<INestApplication<Server>>(AppModule, {
      logger: false,
      abortOnError: false,
    })
    setupApp(app)
    const contractDocument = loadContract(CONTRACT_PATH)
    const generatedDocument = buildOpenApiDocument(app)
    contract = normalizeOpenApi(contractDocument)
    generated = normalizeOpenApi(generatedDocument)
    contractSchemes = normalizeSecuritySchemes(contractDocument)
    generatedSchemes = normalizeSecuritySchemes(generatedDocument)
  })

  afterAll(async () => {
    await app?.close()
    vi.unstubAllEnvs()
  })

  it('las operaciones implementadas existen en el contrato', () => {
    const unknown = IMPLEMENTED_PATHS.filter((operation) => !Object.hasOwn(contract, operation))

    expect(unknown).toEqual([])
  })

  it('cada operación implementada coincide con el contrato', () => {
    const lines = IMPLEMENTED_PATHS.flatMap((operation) =>
      diffOperation(operation, contract[operation], generated[operation]),
    )

    expect(lines, `Diferencias con el contrato:\n${lines.join('\n')}`).toEqual([])
  })

  it('los esquemas de seguridad de Swagger coinciden con los del contrato (type, in, name)', () => {
    expect(Object.keys(contractSchemes).length).toBeGreaterThan(0)
    expect(generatedSchemes).toEqual(contractSchemes)
  })

  it('Swagger solo genera operaciones implementadas (o las extra a propósito)', () => {
    const unlisted = Object.keys(generated).filter(
      (operation) =>
        !IMPLEMENTED_PATHS.includes(operation) && !EXTRA_OPERATIONS.includes(operation),
    )

    expect(
      unlisted,
      'Sumalas a IMPLEMENTED_PATHS (o a EXTRA_OPERATIONS si no son del contrato)',
    ).toEqual([])
  })

  it('lista las operaciones del contrato que faltan implementar', () => {
    const operations = Object.keys(contract)
    const pending = operations.filter((operation) => !IMPLEMENTED_PATHS.includes(operation))

    // eslint-disable-next-line no-console -- el listado de pendientes es la salida del test
    console.info(
      `Operaciones pendientes del contrato (${String(pending.length)} de ${String(operations.length)}):\n` +
        pending.map((operation) => `  ${operation}`).join('\n'),
    )
    expect(operations.length).toBeGreaterThan(0)
    expect(pending).toHaveLength(operations.length - IMPLEMENTED_PATHS.length)
  })

  it.runIf(DIFF_PATH !== '')('diff de una ruta (scripts/openapi-diff.mjs)', () => {
    // eslint-disable-next-line no-console -- el diff es la salida que pide el script
    console.info(diffPath(DIFF_PATH, contract, generated).join('\n'))
  })

  it('no monta Swagger UI en producción', async () => {
    if (app === undefined) throw new Error('La app no se creó')

    expect(setupSwagger(app, { NODE_ENV: 'production' })).toBe(false)
    const response = await request(app.getHttpServer()).get('/api/docs-json')

    expect(response.status).toBe(404)
  })

  it('monta Swagger UI en /api/docs fuera de producción', async () => {
    if (app === undefined) throw new Error('La app no se creó')

    expect(setupSwagger(app, { NODE_ENV: 'development' })).toBe(true)
    const json = await request(app.getHttpServer()).get('/api/docs-json')
    const ui = await request(app.getHttpServer()).get('/api/docs')

    expect(json.status).toBe(200)
    expect(json.body).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Galpón Mates API', version: '1.0.0' },
      servers: [{ url: '/api/v1' }],
    })
    expect(ui.status).toBe(200)
    expect(ui.text).toContain('swagger-ui-init.js')
  })
})
