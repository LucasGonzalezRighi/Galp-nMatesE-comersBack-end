import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

import { AppModule } from '../../../app.module'
import {
  ADMIN_WRITE_DESCRIPTORS,
  ADMIN_WRITE_EXCLUSIONS,
  resolveAdminWrite,
  WRITE_METHODS,
} from '../domain/admin-write'
import { routePathOf } from './audit.interceptor'

/** Clase de un módulo o de un controlador de Nest. */
type NestClass = abstract new (...args: never[]) => unknown

const reflector = new Reflector()

function isClass(value: unknown): value is NestClass {
  return typeof value === 'function'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : []
}

/**
 * Junta los controladores de un módulo y de todo lo que importa, leyendo la metadata de
 * `@Module()` sin levantar la app (ni base, ni Redis). Un módulo dinámico (`forRoot`) trae su
 * clase en `module` y puede sumar imports y controladores propios.
 */
function collectControllers(
  entry: unknown,
  seen: Set<unknown>,
  controllers: Set<NestClass>,
): Set<NestClass> {
  if (seen.has(entry)) return controllers
  seen.add(entry)
  if (isClass(entry)) {
    for (const controller of listOf(reflector.get(MODULE_METADATA.CONTROLLERS, entry))) {
      if (isClass(controller)) controllers.add(controller)
    }
    for (const imported of listOf(reflector.get(MODULE_METADATA.IMPORTS, entry))) {
      collectControllers(imported, seen, controllers)
    }
  } else if (isRecord(entry)) {
    if (typeof entry.forwardRef === 'function') {
      collectControllers((entry.forwardRef as () => unknown)(), seen, controllers)
    }
    collectControllers(entry.module, seen, controllers)
    for (const controller of listOf(entry.controllers)) {
      if (isClass(controller)) controllers.add(controller)
    }
    for (const imported of listOf(entry.imports)) collectControllers(imported, seen, controllers)
  }
  return controllers
}

/** Las escrituras bajo `admin/` de los controladores reales de la app, como `MÉTODO ruta`. */
function adminWritesOfTheApp(): string[] {
  const writes: string[] = []
  for (const controller of collectControllers(AppModule, new Set(), new Set())) {
    const prototype = controller.prototype as Record<string, unknown>
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name]
      if (name === 'constructor' || typeof handler !== 'function') continue
      const verb: unknown = reflector.get(METHOD_METADATA, handler as () => unknown)
      if (typeof verb !== 'number') continue
      const method = RequestMethod[verb] ?? ''
      const path = routePathOf(reflector, controller, handler)
      if ((WRITE_METHODS as readonly string[]).includes(method) && path.startsWith('admin/')) {
        writes.push(`${method} ${path}`)
      }
    }
  }
  return writes.sort()
}

describe('las escrituras del dashboard de la app real', () => {
  const writes = adminWritesOfTheApp()

  it('la app tiene controladores con escrituras bajo admin/', () => {
    expect(writes.length).toBeGreaterThan(20)
    expect(writes).toContain('PATCH admin/categories/:id')
  })

  it('cada una tiene su descriptor o está en la lista de exclusiones, y no sobra ninguna fila', () => {
    // Una escritura nueva se audita sola, de forma genérica (sin foto). Si este test falla,
    // sumala a ADMIN_WRITE_DESCRIPTORS (con su tabla) o, si no cambia datos, a las exclusiones.
    const known = [
      ...ADMIN_WRITE_DESCRIPTORS.map((row) => `${row.method} ${row.path}`),
      ...ADMIN_WRITE_EXCLUSIONS,
    ].sort()

    expect(writes).toEqual(known)
  })

  it('las excluidas no se auditan y las demás resuelven a la acción de su descriptor', () => {
    for (const write of writes) {
      const [method = '', path = ''] = write.split(' ')
      const target = resolveAdminWrite(method, path)
      const described = ADMIN_WRITE_DESCRIPTORS.find((row) => `${row.method} ${row.path}` === write)

      if (ADMIN_WRITE_EXCLUSIONS.includes(write)) expect(target).toBeNull()
      else expect(target).toBe(described?.target)
    }
  })
})
