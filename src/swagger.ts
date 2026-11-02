import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'

import { API_PREFIX } from './app.setup'
import type { Env } from './config/env'

/** Ruta de Swagger UI, fuera del prefijo `/api/v1`: `/api/docs` (y el JSON en `/api/docs-json`). */
export const SWAGGER_PATH = 'api/docs'

/**
 * Genera el documento OpenAPI 3.1 de la API a partir de los controladores y DTOs decorados.
 *
 * Las rutas quedan relativas a `/api/v1` (el servidor del documento), igual que en el contrato del
 * front (`openapi.yaml`), y los esquemas de seguridad usan los mismos nombres y cookies que él.
 *
 * @param app - La app de Nest ya creada (no hace falta `init()` ni `listen()`).
 * @returns El documento OpenAPI que sirve Swagger UI y que compara el test de contrato.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('Galpón Mates API')
    .setVersion('1.0.0')
    .addServer(`/${API_PREFIX}`)
    .addCookieAuth('__Host-galpon_session', { type: 'apiKey', in: 'cookie' }, 'customerSession')
    .addCookieAuth('__Host-galpon_admin', { type: 'apiKey', in: 'cookie' }, 'adminSession')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrfToken')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Order-Token' }, 'orderToken')
    .build()
  return SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true })
}

/**
 * Monta Swagger UI en `/api/docs` salvo en producción, donde la documentación queda cerrada.
 *
 * @param app - La app de Nest ya configurada con `setupApp`.
 * @param env - Variables de entorno validadas (solo se mira `NODE_ENV`).
 * @returns `true` si montó Swagger UI; `false` en producción.
 */
export function setupSwagger(app: INestApplication, env: Pick<Env, 'NODE_ENV'>): boolean {
  if (env.NODE_ENV === 'production') return false
  SwaggerModule.setup(SWAGGER_PATH, app, () => buildOpenApiDocument(app))
  return true
}
