// Piezas de `validation-cases.contract.spec.ts` que usan los archivos de `test/contract/b6/`:
// los tipos de un caso y de su chequeo y las formas de armarlo. Cada tarea de B6 suma sus
// `Mapping` en su archivo de `b6/` y la spec los corre.

import { expect } from 'vitest'

/** Caso del archivo compartido (lo que genera `@galpon/schemas`). */
export interface ValidationCase {
  name: string
  schema: string
  input: Record<string, unknown>
  valid: boolean
  /** Salida del schema del front (solo en los válidos). */
  output?: Record<string, unknown>
  /** Primer mensaje por campo (solo en los inválidos); los anidados van con punto. */
  errors?: Record<string, string>
}

/** Qué le pasa al DTO y qué se espera, ya traducido al nombre de los campos del DTO. */
export interface Check {
  /** Cuerpo que recibe el DTO. */
  body: Record<string, unknown>
  /** Salida esperada de un caso válido, sin los campos que valen `null`; sin ella, solo tiene que pasar. */
  output?: Record<string, unknown> | undefined
  /** Primer mensaje esperado por campo de un caso inválido. */
  errors: Record<string, string>
}

/** Un DTO y la forma de armarle el `Check` a cada caso del archivo (`null`: no le toca). */
export interface Mapping {
  name: string
  dto: new () => object
  check: (validationCase: ValidationCase) => Check | null
  /** Pasa la salida del DTO a lo que queda después del dominio (por defecto, tal cual). */
  effective?: (value: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Saca los campos de la raíz que valen `null` (o `undefined`): el front los omite en la salida.
 *
 * @param value - Objeto a limpiar.
 * @returns Una copia sin esos campos; los anidados quedan como están.
 */
export function withoutNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null))
}

/**
 * Se queda con algunas claves de un objeto.
 *
 * @param source - Objeto de origen.
 * @param keys - Claves a conservar (las que no están se ignoran).
 * @returns Un objeto nuevo con esas claves.
 */
export function pick(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
}

/**
 * Los errores del caso que corresponden a `fields`, con el nombre que les da el DTO.
 *
 * @param validationCase - Caso del archivo compartido.
 * @param rename - Nombre del campo en el DTO, o `null` si no le toca.
 * @returns El primer mensaje por campo, ya renombrado.
 */
export function errorsOf(
  validationCase: ValidationCase,
  rename: (field: string) => string | null,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [field, message] of Object.entries(validationCase.errors ?? {})) {
    const mapped = rename(field)
    if (mapped !== null) errors[mapped] = message
  }
  return errors
}

const sameField = (field: string): string => field

/**
 * El schema del front y el DTO tienen los mismos campos: se compara el caso entero.
 *
 * @param schema - Nombre del schema del front (`registerSchema`…).
 * @returns El armado del chequeo de cada caso de ese schema.
 */
export function wholeCase(schema: string): (validationCase: ValidationCase) => Check | null {
  return (validationCase) =>
    validationCase.schema === schema
      ? {
          body: validationCase.input,
          output: validationCase.output,
          errors: errorsOf(validationCase, sameField),
        }
      : null
}

/**
 * Casos de `schemas` que prueban `fields` (los válidos entran todos; los inválidos, si fallan en
 * alguno).
 *
 * @param schemas - Schemas del front que tocan.
 * @param fields - Campos que prueba el DTO.
 * @param build - Cuerpo y salida esperada de cada caso.
 * @returns El armado del chequeo de cada caso.
 */
export function partialCase(
  schemas: readonly string[],
  fields: readonly string[],
  build: (validationCase: ValidationCase) => Pick<Check, 'body' | 'output'>,
): (validationCase: ValidationCase) => Check | null {
  return (validationCase) => {
    if (!schemas.includes(validationCase.schema)) return null
    const errors = errorsOf(validationCase, (field) => (fields.includes(field) ? field : null))
    if (!validationCase.valid && Object.keys(errors).length === 0) return null
    if (
      validationCase.valid &&
      !fields.every((field) => typeof validationCase.output?.[field] === 'string')
    ) {
      return null
    }
    return { ...build(validationCase), errors }
  }
}

/**
 * Errores del caso; los que el archivo deja sin texto (`null`) solo tienen que fallar.
 *
 * @param validationCase - Caso del archivo compartido.
 * @returns El mensaje esperado por campo (o cualquier texto).
 */
export function errorsOrAnyMessage(validationCase: ValidationCase): Record<string, string> {
  const entries = Object.entries(validationCase.errors ?? {}) as [string, string | null][]
  return Object.fromEntries(
    entries.map(([field, message]) => [field, message ?? (expect.any(String) as string)]),
  )
}
