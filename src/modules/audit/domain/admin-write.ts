import { canonicalId } from '../../../shared/domain/id'

/** Métodos HTTP que escriben. */
export const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Método HTTP de una escritura. */
export type WriteMethod = (typeof WRITE_METHODS)[number]

/** Tipo de la columna clave de una foto: decide cómo se compara el id en la consulta. */
export type SnapshotKeyType = 'uuid' | 'text' | 'integer'

/**
 * De dónde se lee la fila principal de una entidad para la foto de antes y de después. Los nombres
 * de tabla y de columna salen solo de {@link ADMIN_WRITE_DESCRIPTORS}: nunca de un pedido.
 */
export interface SnapshotSource {
  /** Tabla de la fila principal (`categories`, `orders`…). */
  readonly table: string
  /** Columna con la que se busca la fila (`id`, `number`, `key`). */
  readonly keyColumn: string
  /** Tipo de esa columna. */
  readonly keyType: SnapshotKeyType
  /**
   * La fila tiene datos de clientes (pedidos, reseñas, mensajes): nunca se guarda entera, solo las
   * columnas que cambiaron.
   */
  readonly personalData: boolean
}

/** De dónde sale el id de la entidad de una escritura. */
export type EntityIdSource =
  | {
      /** De un parámetro de la ruta (`:id`, `:number`). */
      readonly from: 'param'
      /** Nombre del parámetro. */
      readonly name: string
      /** Texto que va antes del valor (`legal-` en los documentos legales). */
      readonly prefix?: string
    }
  | {
      /** Del `id` del cuerpo de la respuesta (un alta). */
      readonly from: 'response'
    }
  | {
      /** Siempre el mismo (la clave de un contenido, la fila única de los ajustes). */
      readonly from: 'fixed'
      /** El id. */
      readonly value: string
    }
  | {
      /** El usuario admin de la sesión (cambio de contraseña). */
      readonly from: 'actor'
    }
  | {
      /** La escritura no es sobre una sola entidad (reordenar). */
      readonly from: 'none'
    }

/** Cómo se audita una escritura del dashboard. */
export interface AdminWriteTarget {
  /** `<entidad>.<verbo>`: `category.update`, `order.status`… */
  readonly action: string
  /** Tipo de entidad: `category`, `order`, `content`… */
  readonly entityType: string
  /** De dónde sale el id de la entidad. */
  readonly entityId: EntityIdSource
  /** Fila principal para la foto de antes y de después; `null` si no se lee. */
  readonly snapshot: SnapshotSource | null
  /** `false` si el cuerpo nunca se guarda (trae contraseñas). */
  readonly storesInput: boolean
}

/** Fila de {@link ADMIN_WRITE_DESCRIPTORS}: una escritura del dashboard y cómo se audita. */
export interface AdminWriteDescriptor {
  /** Método HTTP. */
  readonly method: WriteMethod
  /** Ruta sin el prefijo de la API ni barras en las puntas (`admin/categories/:id`). */
  readonly path: string
  /** Cómo se audita. */
  readonly target: AdminWriteTarget
}

/** Datos del pedido con los que se resuelve el id de la entidad. */
export interface EntityIdContext {
  /** Parámetros de la ruta, como los deja Express. */
  readonly params: Readonly<Record<string, unknown>>
  /** Usuario admin de la sesión. */
  readonly actorUserId: string
  /** Cuerpo de la respuesta; falta antes de que corra el handler. */
  readonly response?: unknown
}

/** Primer segmento de las rutas del dashboard. */
const ADMIN_SEGMENT = 'admin'

/** Verbo de una escritura sin un segmento fijo al final. */
const VERB_BY_METHOD: Readonly<Record<WriteMethod, string>> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

const FROM_RESPONSE: EntityIdSource = { from: 'response' }
const NO_ENTITY: EntityIdSource = { from: 'none' }

function byParam(name: string): EntityIdSource {
  return { from: 'param', name }
}

/** Fila principal de una tabla sin datos de clientes. */
function mainRow(table: string, keyColumn: string, keyType: SnapshotKeyType): SnapshotSource {
  return { table, keyColumn, keyType, personalData: false }
}

/** Fila principal de una tabla con datos de clientes: solo se guardan las columnas que cambian. */
function customerRow(table: string, keyColumn: string, keyType: SnapshotKeyType): SnapshotSource {
  return { table, keyColumn, keyType, personalData: true }
}

const CATEGORIES = mainRow('categories', 'id', 'uuid')
const COMBOS = mainRow('combos', 'id', 'uuid')
const PRODUCTS = mainRow('products', 'id', 'uuid')
const CONTENT_BLOCKS = mainRow('content_blocks', 'key', 'text')
const SETTINGS = mainRow('settings', 'id', 'integer')
const ORDERS = customerRow('orders', 'number', 'text')
const REVIEWS = customerRow('reviews', 'id', 'uuid')
const CONTACT_MESSAGES = customerRow('contact_messages', 'id', 'uuid')

/** Arma una fila de la tabla; la acción es siempre `<entidad>.<verbo>`. */
function write(
  method: WriteMethod,
  path: string,
  entityType: string,
  verb: string,
  entityId: EntityIdSource,
  snapshot: SnapshotSource | null,
): AdminWriteDescriptor {
  return {
    method,
    path,
    target: { action: `${entityType}.${verb}`, entityType, entityId, snapshot, storesInput: true },
  }
}

/** Guardado de un contenido de clave fija (`home`, `faq`…). */
function content(key: string): AdminWriteDescriptor {
  return write(
    'PUT',
    `admin/content/${key}`,
    'content',
    'update',
    { from: 'fixed', value: key },
    CONTENT_BLOCKS,
  )
}

/**
 * Las escrituras del dashboard y cómo se audita cada una: tipo de entidad, verbo, de dónde sale el
 * id y qué fila se fotografía. Es la única fuente de los nombres de tabla y de columna de las
 * fotos. Una escritura de `admin/` que no está acá se audita igual, de forma genérica
 * ({@link resolveAdminWrite}); las que no se auditan están en {@link ADMIN_WRITE_EXCLUSIONS}.
 */
export const ADMIN_WRITE_DESCRIPTORS: readonly AdminWriteDescriptor[] = [
  write('POST', 'admin/categories', 'category', 'create', FROM_RESPONSE, CATEGORIES),
  write('PUT', 'admin/categories/order', 'category', 'reorder', NO_ENTITY, null),
  write('PATCH', 'admin/categories/:id', 'category', 'update', byParam('id'), CATEGORIES),
  write('DELETE', 'admin/categories/:id', 'category', 'delete', byParam('id'), CATEGORIES),

  write('POST', 'admin/combos', 'combo', 'create', FROM_RESPONSE, COMBOS),
  write('PUT', 'admin/combos/order', 'combo', 'reorder', NO_ENTITY, null),
  write('PATCH', 'admin/combos/:id', 'combo', 'update', byParam('id'), COMBOS),
  write('DELETE', 'admin/combos/:id', 'combo', 'delete', byParam('id'), COMBOS),

  write('POST', 'admin/products', 'product', 'create', FROM_RESPONSE, PRODUCTS),
  write('PATCH', 'admin/products/:id', 'product', 'update', byParam('id'), PRODUCTS),
  write('POST', 'admin/products/:id/archive', 'product', 'archive', byParam('id'), PRODUCTS),

  content('home'),
  content('about'),
  content('faq'),
  content('footer'),
  content('product-tabs'),
  write(
    'PUT',
    'admin/content/legal/:document',
    'content',
    'update',
    { from: 'param', name: 'document', prefix: 'legal-' },
    CONTENT_BLOCKS,
  ),

  write('POST', 'admin/orders/:number/status', 'order', 'status', byParam('number'), ORDERS),
  write('PATCH', 'admin/reviews/:id', 'review', 'update', byParam('id'), REVIEWS),
  write('PUT', 'admin/settings', 'settings', 'update', { from: 'fixed', value: '1' }, SETTINGS),
  write(
    'PATCH',
    'admin/messages/:id',
    'contact_message',
    'update',
    byParam('id'),
    CONTACT_MESSAGES,
  ),

  // El cuerpo trae contraseñas: nunca se guarda, y tampoco se fotografía la fila del usuario.
  {
    method: 'POST',
    path: 'admin/auth/password',
    target: {
      action: 'admin_user.password',
      entityType: 'admin_user',
      entityId: { from: 'actor' },
      snapshot: null,
      storesInput: false,
    },
  },
]

/**
 * Escrituras de `admin/` que no se auditan: el inicio y el cierre de sesión ya quedan en el log y
 * la firma de fotos no cambia datos.
 */
export const ADMIN_WRITE_EXCLUSIONS: readonly string[] = [
  'POST admin/auth/login',
  'POST admin/auth/logout',
  'POST admin/media/signature',
]

const DESCRIBED: ReadonlyMap<string, AdminWriteTarget> = new Map(
  ADMIN_WRITE_DESCRIPTORS.map((row) => [`${row.method} ${row.path}`, row.target]),
)

const EXCLUDED: ReadonlySet<string> = new Set(ADMIN_WRITE_EXCLUSIONS)

function isWriteMethod(method: string): method is WriteMethod {
  return (WRITE_METHODS as readonly string[]).includes(method)
}

function isParam(segment: string): boolean {
  return segment.startsWith(':')
}

/** Nombre de un parámetro de ruta (`:id` → `id`). */
function paramName(segment: string): string {
  return /^:(\w+)/.exec(segment)?.[1] ?? ''
}

/** Segmento de ruta como nombre estable: minúsculas y guiones bajos (`gift-cards` → `gift_cards`). */
function stableName(segment: string): string {
  const name = segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return name === '' ? 'unknown' : name
}

/**
 * Auditoría genérica de una escritura de `admin/` sin descriptor (una ruta nueva): el tipo de
 * entidad es el primer segmento después de `admin/`; el verbo, el último segmento fijo si lo hay
 * (`order` en un `PUT` es `reorder`) o, si no, el del método; el id, el primer parámetro de la
 * ruta. Sin foto: solo queda lo que mandó el dashboard.
 */
function genericTarget(method: WriteMethod, segments: readonly string[]): AdminWriteTarget {
  const [resource = '', ...rest] = segments
  const entityType = stableName(resource)
  const last = rest.at(-1)
  let verb = VERB_BY_METHOD[method]
  if (last !== undefined && !isParam(last)) {
    verb = method === 'PUT' && last === 'order' ? 'reorder' : stableName(last)
  }
  const param = segments.find(isParam)
  return {
    action: `${entityType}.${verb}`,
    entityType,
    entityId: param === undefined ? NO_ENTITY : byParam(paramName(param)),
    snapshot: null,
    storesInput: true,
  }
}

/**
 * Decide si una ruta es una escritura del dashboard que se audita y cómo.
 *
 * @param method - Método HTTP del pedido, en mayúsculas o minúsculas.
 * @param path - Ruta del handler sin el prefijo de la API, con los parámetros como `:nombre`
 *   (`admin/categories/:id`); las barras de las puntas no importan.
 * @returns Cómo auditarla, o `null` si no es una escritura (`POST`, `PUT`, `PATCH`, `DELETE`), no
 *   está bajo `admin/` o está en {@link ADMIN_WRITE_EXCLUSIONS}.
 * @example
 * resolveAdminWrite('PATCH', 'admin/categories/:id')?.action // 'category.update'
 * resolveAdminWrite('POST', 'admin/auth/login') // null
 * resolveAdminWrite('POST', 'admin/coupons')?.action // 'coupons.create' (genérica)
 */
export function resolveAdminWrite(method: string, path: string): AdminWriteTarget | null {
  const writeMethod = method.toUpperCase()
  if (!isWriteMethod(writeMethod)) return null
  const segments = path.split('/').filter((segment) => segment !== '')
  if (segments.length < 2 || segments[0] !== ADMIN_SEGMENT) return null
  const key = `${writeMethod} ${segments.join('/')}`
  if (EXCLUDED.has(key)) return null
  return DESCRIBED.get(key) ?? genericTarget(writeMethod, segments.slice(1))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Id tal como se guarda: un texto no vacío, con los UUID en minúsculas. */
function storableId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? canonicalId(value) : null
}

/**
 * Resuelve el id de la entidad de una escritura.
 *
 * @param source - De dónde sale.
 * @param context - Parámetros de la ruta, admin de la sesión y, después del handler, la respuesta.
 * @returns El id (un UUID, en minúsculas), o `null` si la escritura no tiene una entidad, si el
 *   parámetro falta o si todavía no se sabe (un alta antes de responder).
 */
export function entityIdOf(source: EntityIdSource, context: EntityIdContext): string | null {
  switch (source.from) {
    case 'param': {
      const value = Object.hasOwn(context.params, source.name)
        ? storableId(context.params[source.name])
        : null
      return value === null ? null : `${source.prefix ?? ''}${value}`
    }
    case 'response':
      return isRecord(context.response) && Object.hasOwn(context.response, 'id')
        ? storableId(context.response.id)
        : null
    case 'fixed':
      return source.value
    case 'actor':
      return context.actorUserId
    case 'none':
      return null
  }
}
