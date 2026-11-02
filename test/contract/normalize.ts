import type { OpenAPIObject } from '@nestjs/swagger'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

/**
 * Documento OpenAPI tal como sale de parsear el `openapi.yaml` del front. Solo se tipan las partes
 * que se comparan; el resto se recorre como JSON desconocido.
 */
export interface ContractDocument {
  openapi: string
  paths: Record<string, unknown>
  components?: Record<string, unknown>
}

/** Parámetro de una operación reducido a lo que se compara. */
export interface NormalizedParameter {
  name: string
  in: string
  /** `required` explícito, o `false` si no está (el default de OpenAPI). */
  required: boolean
  schema: unknown
}

/** Operación reducida a lo que se compara contra el contrato. */
export interface NormalizedOperation {
  /** Parámetros de la ruta y de la operación, con `$ref` resueltos, ordenados por `in` y `name`. */
  parameters: NormalizedParameter[]
  /** Códigos de respuesta ordenados (`'200'`, `'404'`, …). */
  responses: string[]
  /** Esquemas de las respuestas 2xx, por código y tipo de contenido. */
  success: Record<string, Record<string, unknown>>
  /**
   * Esquemas de `components.schemas` alcanzables desde los parámetros y las respuestas 2xx, por
   * nombre (`null` si el `$ref` apunta a uno que no existe). En Swagger el nombre es el de la
   * clase del DTO (o el de `@ApiSchema`), así que tiene que coincidir con el del contrato.
   */
  schemas: Record<string, unknown>
}

/** Operaciones normalizadas por clave `MÉTODO /ruta` (por ejemplo `GET /products/{slug}`). */
export type NormalizedContract = Record<string, NormalizedOperation>

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const

/** Documentación y metadatos: no cambian el contrato y se ignoran (también todo `x-*`). */
const IGNORED_KEYS = new Set([
  'description',
  'summary',
  'example',
  'examples',
  'deprecated',
  'operationId',
  'tags',
])

/** Palabras clave cuyo valor es un mapa `nombre → esquema`: los nombres no se filtran. */
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas'])

/** Palabras clave cuyo valor es un dato y no un esquema: se comparan tal cual. */
const DATA_KEYS = new Set(['enum', 'const', 'default'])

/** Palabras clave cuyo valor es un conjunto: el orden no importa. */
const SET_KEYS = new Set(['required', 'type'])

const SCHEMA_REF_PREFIX = '#/components/schemas/'
const MAX_SHOWN_LENGTH = 160

/**
 * Lee y parsea el contrato del front.
 *
 * @param path - Ruta absoluta del `openapi.yaml`.
 * @returns El documento, con `openapi` y `paths` validados.
 * @throws Error si el archivo no se puede leer o no es un documento OpenAPI.
 */
export function loadContract(path: string): ContractDocument {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(
      `No se pudo leer el contrato en ${path}: dejá el front en ../frontend o definí CONTRACT_PATH`,
      { cause: error },
    )
  }
  const parsed: unknown = parse(text)
  const openapi = isRecord(parsed) ? parsed.openapi : undefined
  const paths = isRecord(parsed) ? parsed.paths : undefined
  if (typeof openapi !== 'string' || !isRecord(paths)) {
    throw new Error(`${path} no es un documento OpenAPI: le faltan "openapi" o "paths"`)
  }
  const components = isRecord(parsed) ? parsed.components : undefined
  return { openapi, paths, ...(isRecord(components) ? { components } : {}) }
}

/**
 * Reduce un documento OpenAPI (el contrato o el que genera Swagger) a lo que importa para
 * compararlos: por cada operación, sus parámetros (`name`, `in`, `required`, `schema`), sus
 * códigos de respuesta y los esquemas de sus respuestas 2xx.
 *
 * Ordena las claves, quita `description`, `summary`, `example`, `examples`, `deprecated`,
 * `operationId`, `tags` y `x-*`, resuelve los `$ref` de parámetros y respuestas, reemplaza los de
 * esquemas por su nombre (y suma esos esquemas en `schemas`) y aplana los `allOf` de un elemento.
 *
 * @param doc - Documento OpenAPI 3.x.
 * @returns Las operaciones normalizadas, por clave `MÉTODO /ruta`.
 * @throws Error si el documento no tiene `paths` o tiene un `$ref` roto o circular.
 */
export function normalizeOpenApi(doc: OpenAPIObject | ContractDocument): NormalizedContract {
  const root: unknown = doc
  if (!isRecord(root) || !isRecord(root.paths)) {
    throw new Error('El documento OpenAPI no tiene "paths"')
  }
  const paths = root.paths
  const components = isRecord(root.components) ? root.components : {}
  const schemas = isRecord(components.schemas) ? components.schemas : {}
  const result: NormalizedContract = {}
  for (const path of Object.keys(paths).sort()) {
    const pathItem = resolveRef(root, paths[path])
    if (!isRecord(pathItem)) continue
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isRecord(operation)) continue
      const key = `${method.toUpperCase()} ${path}`
      const refs = new Set<string>()
      result[key] = {
        parameters: normalizeParameters(root, key, pathItem, operation, refs),
        ...normalizeResponses(root, operation, refs),
        schemas: collectSchemas(refs, schemas),
      }
    }
  }
  return result
}

/**
 * Compara una operación del contrato con la que genera Swagger.
 *
 * @param key - Clave de la operación (`MÉTODO /ruta`), para los mensajes.
 * @param expected - La operación normalizada del contrato (`undefined` si no está).
 * @param actual - La operación normalizada de Swagger (`undefined` si no está).
 * @returns Una línea legible por diferencia (vacío si coinciden).
 */
export function diffOperation(
  key: string,
  expected: NormalizedOperation | undefined,
  actual: NormalizedOperation | undefined,
): string[] {
  if (expected === undefined && actual === undefined) {
    return [`${key}: no está en el contrato ni en Swagger`]
  }
  if (expected === undefined) return [`${key}: Swagger la genera pero el contrato no la tiene`]
  if (actual === undefined) return [`${key}: está en el contrato pero Swagger no la genera`]
  const lines: string[] = []
  const missing = expected.responses.filter((code) => !actual.responses.includes(code))
  const extra = actual.responses.filter((code) => !expected.responses.includes(code))
  if (missing.length > 0) lines.push(`${key} › respuestas: faltan ${missing.join(', ')}`)
  if (extra.length > 0) lines.push(`${key} › respuestas: sobran ${extra.join(', ')}`)
  lines.push(
    ...diffValues(
      indexParameters(expected.parameters),
      indexParameters(actual.parameters),
      `${key} › parámetros`,
    ),
    ...diffValues(expected.success, actual.success, `${key} › respuesta`),
    ...diffValues(expected.schemas, actual.schemas, `${key} › esquema`),
  )
  return lines
}

/**
 * Compara todas las operaciones de una ruta (todos sus métodos) entre el contrato y Swagger.
 *
 * @param path - Ruta relativa a `/api/v1`, con `/` inicial (por ejemplo `/products/{slug}`).
 * @param expected - El contrato normalizado.
 * @param actual - El documento de Swagger normalizado.
 * @returns Las diferencias de cada operación, o `sin diferencias` por operación.
 * @throws Error si la ruta no empieza con `/`.
 */
export function diffPath(
  path: string,
  expected: NormalizedContract,
  actual: NormalizedContract,
): string[] {
  if (!path.startsWith('/')) throw new Error(`La ruta tiene que empezar con "/": ${path}`)
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((key) => key.slice(key.indexOf(' ') + 1) === path)
    .sort()
  if (keys.length === 0) return [`${path}: no está en el contrato ni en Swagger`]
  return keys.flatMap((key) => {
    const lines = diffOperation(key, expected[key], actual[key])
    return lines.length > 0 ? lines : [`${key}: sin diferencias`]
  })
}

function normalizeParameters(
  root: Record<string, unknown>,
  key: string,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  refs: Set<string>,
): NormalizedParameter[] {
  const byLocation = new Map<string, NormalizedParameter>()
  for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const parameter = resolveRef(root, raw)
    const name = isRecord(parameter) ? parameter.name : undefined
    const location = isRecord(parameter) ? parameter.in : undefined
    if (!isRecord(parameter) || typeof name !== 'string' || typeof location !== 'string') {
      throw new Error(`${key} tiene un parámetro sin "name" o sin "in"`)
    }
    byLocation.set(`${location} ${name}`, {
      name,
      in: location,
      required: parameter.required === true,
      schema: normalizeSchema(parameter.schema, refs) ?? null,
    })
  }
  return [...byLocation.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, parameter]) => parameter)
}

function normalizeResponses(
  root: Record<string, unknown>,
  operation: Record<string, unknown>,
  refs: Set<string>,
): Pick<NormalizedOperation, 'responses' | 'success'> {
  const responses = isRecord(operation.responses) ? operation.responses : {}
  const codes = Object.keys(responses)
    .filter((code) => !code.startsWith('x-'))
    .sort()
  const success: Record<string, Record<string, unknown>> = {}
  for (const code of codes.filter((candidate) => candidate.startsWith('2'))) {
    const response = resolveRef(root, responses[code])
    const content = isRecord(response) && isRecord(response.content) ? response.content : {}
    success[code] = Object.fromEntries(
      Object.keys(content)
        .sort()
        .map((mediaType) => {
          const media = content[mediaType]
          return [
            mediaType,
            normalizeSchema(isRecord(media) ? media.schema : undefined, refs) ?? null,
          ]
        }),
    )
  }
  return { responses: codes, success }
}

function normalizeSchema(schema: unknown, refs: Set<string>): unknown {
  if (isArray(schema)) return schema.map((item) => normalizeSchema(item, refs))
  if (!isRecord(schema)) return schema
  const { allOf, ...rest } = schema
  if (isArray(allOf) && allOf.length === 1) {
    const inner = normalizeSchema(allOf[0], refs)
    const outer = normalizeSchema(rest, refs)
    if (isRecord(inner) && isRecord(outer)) return sortKeys({ ...inner, ...outer })
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(schema).sort()) {
    if (IGNORED_KEYS.has(key) || key.startsWith('x-')) continue
    const value = schema[key]
    if (key === '$ref' && typeof value === 'string') result[key] = schemaName(value, refs)
    else if (DATA_KEYS.has(key)) result[key] = sortKeys(value)
    else if (SET_KEYS.has(key) && isArray(value)) result[key] = [...value].map(String).sort()
    else if (SCHEMA_MAP_KEYS.has(key) && isRecord(value)) {
      result[key] = Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((name) => [name, normalizeSchema(value[name], refs)]),
      )
    } else result[key] = normalizeSchema(value, refs)
  }
  return result
}

/** Esquemas alcanzables desde `names`, siguiendo los `$ref` de cada uno. */
function collectSchemas(
  names: Iterable<string>,
  components: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const pending = [...names]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (Object.hasOwn(result, name)) continue
    const found = new Set<string>()
    result[name] = Object.hasOwn(components, name) ? normalizeSchema(components[name], found) : null
    pending.push(...found)
  }
  return Object.fromEntries(
    Object.keys(result)
      .sort()
      .map((name) => [name, result[name]]),
  )
}

function schemaName(ref: string, refs: Set<string>): string {
  if (!ref.startsWith(SCHEMA_REF_PREFIX)) return ref
  const name = unescapePointer(ref.slice(SCHEMA_REF_PREFIX.length))
  refs.add(name)
  return name
}

/** Sigue los `$ref` locales (`#/…`) hasta llegar a un objeto que no es una referencia. */
function resolveRef(root: Record<string, unknown>, value: unknown): unknown {
  let current = value
  for (let depth = 0; isRecord(current) && typeof current.$ref === 'string'; depth++) {
    if (depth >= 20) throw new Error(`Referencia circular: ${current.$ref}`)
    current = resolvePointer(root, current.$ref)
  }
  return current
}

function resolvePointer(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Solo se admiten referencias locales (#/…): ${ref}`)
  let node: unknown = root
  for (const segment of ref.slice(2).split('/')) {
    const key = unescapePointer(segment)
    if (!isRecord(node) || !Object.hasOwn(node, key)) {
      throw new Error(`La referencia ${ref} no existe en el documento`)
    }
    node = node[key]
  }
  return node
}

function unescapePointer(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function indexParameters(parameters: NormalizedParameter[]): Record<string, unknown> {
  return Object.fromEntries(
    parameters.map((parameter) => [
      `${parameter.in} ${parameter.name}`,
      { required: parameter.required, schema: parameter.schema },
    ]),
  )
}

function diffValues(expected: unknown, actual: unknown, path: string): string[] {
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    return keys.flatMap((key) => {
      const child = `${path}.${key}`
      if (!Object.hasOwn(actual, key)) {
        return [`${child}: falta en Swagger (contrato: ${show(expected[key])})`]
      }
      if (!Object.hasOwn(expected, key))
        return [`${child}: sobra en Swagger (${show(actual[key])})`]
      return diffValues(expected[key], actual[key], child)
    })
  }
  if (isArray(expected) && isArray(actual) && expected.length === actual.length) {
    return expected.flatMap((item, index) =>
      diffValues(item, actual[index], `${path}[${String(index)}]`),
    )
  }
  const same = !isObject(expected) && !isObject(actual) && expected === actual
  return same ? [] : [`${path}: contrato ${show(expected)} · Swagger ${show(actual)}`]
}

function show(value: unknown): string {
  const text = value === undefined ? 'undefined' : JSON.stringify(value)
  return text.length > MAX_SHOWN_LENGTH ? `${text.slice(0, MAX_SHOWN_LENGTH)}…` : text
}

function sortKeys(value: unknown): unknown {
  if (isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  )
}

function asArray(value: unknown): readonly unknown[] {
  return isArray(value) ? value : []
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}
