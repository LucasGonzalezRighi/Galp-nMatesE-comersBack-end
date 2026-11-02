import type { INestApplication, ModuleMetadata } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'

import { ProblemFilter } from '../../src/shared/infrastructure/http/problem.filter'
import { createValidationPipe } from '../../src/shared/infrastructure/http/validation.pipe'

/**
 * Arma una app HTTP mínima con algunos controladores y sus dependencias (por ejemplo queries en
 * memoria), con el mismo filtro de errores y el mismo pipe de validación que `setupApp`, pero sin
 * prefijo, base, Redis ni Docker: sirve para probar los controladores en `npm test`.
 *
 * @param metadata - Controladores, proveedores e imports del módulo de prueba.
 * @returns La app ya inicializada; quien la crea la cierra con `app.close()`.
 */
export async function createControllerApp(
  metadata: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'>,
): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule(metadata).compile()
  const app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false })
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  await app.init()
  return app
}
