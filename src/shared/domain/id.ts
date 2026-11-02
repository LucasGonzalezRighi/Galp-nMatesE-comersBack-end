import { v7, validate, version } from 'uuid'

/**
 * Genera el id de una entidad nueva: un UUID v7 (ordenable por fecha de creación).
 *
 * @returns El id, en minúsculas con guiones.
 */
export function newId(): string {
  return v7()
}

/**
 * Indica si un valor es un id de la app (UUID v7).
 *
 * @param value - Lo que se quiere comprobar.
 * @returns `true` si es un string con un UUID v7 válido.
 */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && validate(value) && version(value) === 7
}
