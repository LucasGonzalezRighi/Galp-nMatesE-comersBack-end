import { describe, expect, it } from 'vitest'

import {
  type ContractDocument,
  diffOperation,
  normalizeOpenApi,
  normalizeSecuritySchemes,
} from './normalize'

const KEY = 'POST /auth/login'

/** Documento mínimo con una escritura: CSRF, cuerpo obligatorio y esquema por `$ref`. */
function loginDocument(): ContractDocument {
  return {
    openapi: '3.1.0',
    paths: {
      '/auth/login': {
        post: {
          security: [{ csrfToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CustomerLogin' } },
            },
          },
          responses: { '200': { description: 'Sesión iniciada.' } },
        },
      },
      '/auth/logout': {
        post: {
          security: [{ customerSession: [], csrfToken: [] }],
          responses: { '204': { description: 'Sesión cerrada.' } },
        },
      },
      '/categories': {
        get: { security: [], responses: { '200': { description: 'Categorías.' } } },
      },
    },
    components: {
      securitySchemes: {
        csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'CSRF.' },
        customerSession: { type: 'apiKey', in: 'cookie', name: '__Host-galpon_session' },
      },
      requestBodies: {},
      schemas: {
        CustomerLogin: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { $ref: '#/components/schemas/Email' },
            password: { type: 'string', minLength: 1 },
          },
        },
        Email: { type: 'string', format: 'email', maxLength: 254 },
      },
    },
  }
}

/** Copia profunda para cambiar una parte sin tocar el original. */
function clone(doc: ContractDocument): ContractDocument {
  return structuredClone(doc)
}

function operation(doc: ContractDocument, path: string): Record<string, unknown> {
  const item = doc.paths[path] as Record<string, Record<string, unknown>>
  const post = item.post ?? item.get
  if (post === undefined) throw new Error(`No hay operación en ${path}`)
  return post
}

describe('normalizeOpenApi: security', () => {
  it('normaliza cada requisito a los esquemas exigidos juntos, ordenados', () => {
    const normalized = normalizeOpenApi(loginDocument())

    expect(normalized[KEY]?.security).toEqual([['csrfToken']])
    expect(normalized['POST /auth/logout']?.security).toEqual([['csrfToken', 'customerSession']])
    expect(normalized['GET /categories']?.security).toEqual([])
  })

  it('una operación sin security equivale a security: []', () => {
    const withoutSecurity = clone(loginDocument())
    delete operation(withoutSecurity, '/categories').security

    expect(normalizeOpenApi(withoutSecurity)['GET /categories']).toEqual(
      normalizeOpenApi(loginDocument())['GET /categories'],
    )
  })

  it('dos documentos iguales salvo security difieren', () => {
    const changed = clone(loginDocument())
    operation(changed, '/auth/logout').security = [{ customerSession: [] }]
    const key = 'POST /auth/logout'

    const lines = diffOperation(
      key,
      normalizeOpenApi(loginDocument())[key],
      normalizeOpenApi(changed)[key],
    )

    expect(lines).toEqual([
      'POST /auth/logout › security: contrato [["csrfToken","customerSession"]] · Swagger [["customerSession"]]',
    ])
  })

  it('compara los requisitos alternativos como conjunto', () => {
    const left = clone(loginDocument())
    const right = clone(loginDocument())
    operation(left, '/auth/login').security = [{ csrfToken: [] }, { customerSession: [] }]
    operation(right, '/auth/login').security = [{ customerSession: [] }, { csrfToken: [] }]

    expect(normalizeOpenApi(left)[KEY]).toEqual(normalizeOpenApi(right)[KEY])
  })
})

describe('normalizeOpenApi: requestBody', () => {
  it('normaliza required y el esquema por media type, y suma los esquemas alcanzables', () => {
    const normalized = normalizeOpenApi(loginDocument())[KEY]

    expect(normalized?.requestBody).toEqual({
      required: true,
      content: { 'application/json': { $ref: 'CustomerLogin' } },
    })
    expect(Object.keys(normalized?.schemas ?? {})).toEqual(['CustomerLogin', 'Email'])
    expect(normalizeOpenApi(loginDocument())['POST /auth/logout']?.requestBody).toBeNull()
  })

  it('resuelve un requestBody por $ref y toma required ausente como false', () => {
    const viaRef = clone(loginDocument())
    const body = operation(viaRef, '/auth/login').requestBody as Record<string, unknown>
    delete body.required
    viaRef.components = {
      ...viaRef.components,
      requestBodies: { Login: body },
    }
    operation(viaRef, '/auth/login').requestBody = { $ref: '#/components/requestBodies/Login' }

    expect(normalizeOpenApi(viaRef)[KEY]?.requestBody).toEqual({
      required: false,
      content: { 'application/json': { $ref: 'CustomerLogin' } },
    })
  })

  it('dos documentos iguales salvo requestBody.required difieren', () => {
    const changed = clone(loginDocument())
    ;(operation(changed, '/auth/login').requestBody as Record<string, unknown>).required = false

    const lines = diffOperation(
      KEY,
      normalizeOpenApi(loginDocument())[KEY],
      normalizeOpenApi(changed)[KEY],
    )

    expect(lines).toEqual(['POST /auth/login › cuerpo.required: contrato true · Swagger false'])
  })

  it('detecta un cambio en el esquema del cuerpo', () => {
    const changed = clone(loginDocument())
    const schemas = changed.components?.schemas as Record<string, Record<string, unknown>>
    schemas.CustomerLogin = { ...schemas.CustomerLogin, required: ['email'] }

    const lines = diffOperation(
      KEY,
      normalizeOpenApi(loginDocument())[KEY],
      normalizeOpenApi(changed)[KEY],
    )

    expect(lines.some((line) => line.includes('esquema.CustomerLogin.required'))).toBe(true)
  })

  it('un cuerpo que falta en Swagger se informa', () => {
    const changed = clone(loginDocument())
    delete operation(changed, '/auth/login').requestBody

    const lines = diffOperation(
      KEY,
      normalizeOpenApi(loginDocument())[KEY],
      normalizeOpenApi(changed)[KEY],
    )

    expect(lines).toContain(
      'POST /auth/login › cuerpo: contrato {"required":true,"content":{"application/json":{"$ref":"CustomerLogin"}}} · Swagger null',
    )
  })
})

describe('normalizeSecuritySchemes', () => {
  it('reduce cada esquema a type, in y name (sin descripciones)', () => {
    expect(normalizeSecuritySchemes(loginDocument())).toEqual({
      csrfToken: { in: 'header', name: 'X-CSRF-Token', type: 'apiKey' },
      customerSession: { in: 'cookie', name: '__Host-galpon_session', type: 'apiKey' },
    })
    expect(normalizeSecuritySchemes({ openapi: '3.1.0', paths: {} })).toEqual({})
  })
})
