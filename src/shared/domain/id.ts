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

/** Forma de un UUID cualquiera (sin mirar versión ni variante), en mayúsculas o minúsculas. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Forma canónica de un id que llega de afuera: un UUID va en minúsculas (no distingue mayúsculas y
 * Postgres lo guarda y lo devuelve así); cualquier otro texto queda como vino.
 *
 * @param id - Id pedido.
 * @returns El mismo id, en minúsculas si tiene forma de UUID.
 * @example
 * canonicalId('0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B') // '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
 * canonicalId('cmb-Duo') // 'cmb-Duo'
 */
export function canonicalId(id: string): string {
  return UUID_SHAPE.test(id) ? id.toLowerCase() : id
}
