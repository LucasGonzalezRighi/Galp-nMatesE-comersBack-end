/** Fila principal de una entidad como JSON (`to_jsonb` de Postgres): columna → valor. */
export type JsonRow = Readonly<Record<string, unknown>>

/** Foto de una escritura: la fila (o sus columnas que cambiaron) antes y después. */
export interface SnapshotDiff {
  /** Antes de la escritura; `null` en un alta. */
  readonly before: JsonRow | null
  /** Después de la escritura; `null` en un borrado. */
  readonly after: JsonRow | null
}

/** Lo que queda en `input` cuando el cuerpo pasa de {@link MAX_INPUT_BYTES}. */
export interface TruncatedInput {
  /** Marca de que el cuerpo no se guardó. */
  readonly truncated: true
  /** Tamaño del cuerpo como JSON, en bytes de UTF-8. */
  readonly bytes: number
}

/**
 * Columna `changes` de `audit_logs`. Las claves que no aplican no van: sin cuerpo no hay `input`;
 * sin foto (reordenar, una ruta genérica, el cambio de contraseña) no hay `before` ni `after`.
 */
export interface AuditChanges {
  /** Lo que mandó el dashboard, o {@link TruncatedInput} si era muy grande. */
  input?: unknown
  /** En una edición, las columnas que cambiaron; en un borrado, la fila; `null` en un alta. */
  before?: JsonRow | null
  /** En una edición, las columnas que cambiaron; en un alta, la fila; `null` en un borrado. */
  after?: JsonRow | null
}

/** Tamaño máximo del cuerpo que se guarda en `input`: 32 kB como JSON, en bytes de UTF-8. */
export const MAX_INPUT_BYTES = 32 * 1024

/** Columnas que cambian en cada escritura y no dicen nada. */
const IGNORED_COLUMNS: ReadonlySet<string> = new Set(['updated_at'])

/**
 * Prepara el cuerpo del pedido para guardarlo en `input`.
 *
 * @param body - Cuerpo que mandó el dashboard (ya pasó la validación), o `undefined` si no mandó.
 * @returns Una copia del cuerpo como JSON; `{ truncated: true, bytes }` si pasa de
 *   {@link MAX_INPUT_BYTES}; `undefined` si no hay cuerpo o no se puede pasar a JSON.
 * @example
 * auditInput({ name: 'Imperiales' }) // { name: 'Imperiales' }
 * auditInput({ text: 'a'.repeat(40_000) }) // { truncated: true, bytes: 40011 }
 */
export function auditInput(body: unknown): unknown {
  // `JSON.stringify` devuelve `undefined` (no un texto) con `undefined` o una función.
  let json: unknown
  try {
    json = JSON.stringify(body)
  } catch {
    return undefined
  }
  if (typeof json !== 'string') return undefined
  const bytes = new TextEncoder().encode(json).length
  if (bytes > MAX_INPUT_BYTES) return { truncated: true, bytes } satisfies TruncatedInput
  return JSON.parse(json) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Compara dos valores JSON por contenido (el orden de las claves de un objeto no importa). */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  )
}

/**
 * Arma la foto de una escritura a partir de la fila principal leída antes y después.
 *
 * - Edición (están las dos): solo las columnas cuyo valor cambió, con las mismas claves en
 *   `before` y `after`; `updated_at` no cuenta.
 * - Alta (no estaba antes): `before: null` y la fila entera en `after`.
 * - Borrado (no está después): la fila entera en `before` y `after: null`.
 *
 * Una fila con datos de clientes (`personalData`) nunca se guarda entera: en un alta o un borrado
 * no hay foto.
 *
 * @param before - Fila antes de la escritura, o `null` si no existía (o no se leyó).
 * @param after - Fila después de la escritura, o `null` si ya no existe.
 * @param personalData - Si la fila tiene datos de clientes (pedidos, reseñas, mensajes).
 * @returns La foto, o `null` si no hay nada que guardar.
 * @example
 * diffSnapshot({ status: 'paid', contact_email: 'a@b.c' }, { status: 'shipped', contact_email: 'a@b.c' }, true)
 * // { before: { status: 'paid' }, after: { status: 'shipped' } }
 */
export function diffSnapshot(
  before: JsonRow | null,
  after: JsonRow | null,
  personalData: boolean,
): SnapshotDiff | null {
  if (before === null && after === null) return null
  if (before === null || after === null) return personalData ? null : { before, after }
  const changedBefore: Record<string, unknown> = {}
  const changedAfter: Record<string, unknown> = {}
  for (const column of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORED_COLUMNS.has(column)) continue
    const previous = Object.hasOwn(before, column) ? before[column] : null
    const current = Object.hasOwn(after, column) ? after[column] : null
    if (sameJson(previous, current)) continue
    changedBefore[column] = previous
    changedAfter[column] = current
  }
  return { before: changedBefore, after: changedAfter }
}

/**
 * Arma la columna `changes` de una fila de auditoría.
 *
 * @param input - Lo que devuelve {@link auditInput}; `undefined` si no se guarda el cuerpo.
 * @param snapshot - Lo que devuelve {@link diffSnapshot}; `null` si no hay foto.
 * @returns `{ input, before, after }` sin las claves que no aplican (puede quedar `{}`).
 */
export function buildChanges(input: unknown, snapshot: SnapshotDiff | null): AuditChanges {
  const changes: AuditChanges = {}
  if (input !== undefined) changes.input = input
  if (snapshot !== null) {
    changes.before = snapshot.before
    changes.after = snapshot.after
  }
  return changes
}
