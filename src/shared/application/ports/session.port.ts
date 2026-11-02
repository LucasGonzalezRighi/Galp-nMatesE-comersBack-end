/** Tipo de sesión: anónima (solo para el CSRF de la tienda), de cliente o de administrador. */
export type SessionKind = 'anonymous' | 'customer' | 'admin'

/** Sesión guardada. Las fechas van en ISO 8601 UTC. */
export interface SessionRecord {
  /** Id de la sesión (32 bytes aleatorios en hex): es el valor de la cookie. */
  id: string
  /** Tipo de sesión. */
  kind: SessionKind
  /** Usuario dueño; `null` en una sesión anónima. */
  userId: string | null
  /** Cliente asociado; `null` en una sesión anónima o de admin. */
  customerId: string | null
  /** Token anti-CSRF de esta sesión (32 bytes aleatorios en hex). */
  csrfToken: string
  /** Cuándo se creó (ISO 8601 UTC). */
  createdAt: string
  /** Cuándo vence, fijo desde la creación: no se renueva (ISO 8601 UTC). */
  expiresAt: string
}

/** Datos para abrir una sesión nueva; el id, el CSRF y las fechas los pone el almacén. */
export interface NewSession {
  /** Tipo de sesión; define su duración ({@link SESSION_TTL_SECONDS}). */
  kind: SessionKind
  /** Usuario dueño; `null` en una sesión anónima. */
  userId: string | null
  /** Cliente asociado; `null` en una sesión anónima o de admin. */
  customerId: string | null
}

/**
 * Almacén de sesiones que **falla cerrado**: si no responde, cada operación lanza un
 * `DomainError` 503 `service_unavailable` (nunca deja pasar una sesión que no pudo verificar).
 */
export interface SessionPort {
  /**
   * Abre una sesión con id y token CSRF nuevos.
   *
   * @param input - Tipo de sesión y a quién pertenece.
   * @returns La sesión creada, con su vencimiento.
   */
  create(input: NewSession): Promise<SessionRecord>

  /**
   * Busca una sesión.
   *
   * @param id - Id de la sesión (el valor de la cookie).
   * @returns La sesión, o `null` si no existe, venció o el id no tiene el formato esperado.
   */
  get(id: string): Promise<SessionRecord | null>

  /**
   * Cierra una sesión (si no existe, no hace nada).
   *
   * @param id - Id de la sesión.
   */
  destroy(id: string): Promise<void>

  /**
   * Cierra todas las sesiones de un usuario (por ejemplo, al restablecer la contraseña).
   *
   * @param userId - Id del usuario.
   */
  destroyAllForUser(userId: string): Promise<void>
}

/** Token de inyección del {@link SessionPort}: `@Inject(SESSION_PORT) sessions: SessionPort`. */
export const SESSION_PORT = Symbol('SESSION_PORT')

/** Duración de cada tipo de sesión, en segundos: anónima 24 h, cliente 30 días, admin 8 h. */
export const SESSION_TTL_SECONDS = {
  anonymous: 86_400,
  customer: 2_592_000,
  admin: 28_800,
} as const

/**
 * Valida los datos de una sesión nueva: la anónima no tiene usuario ni cliente, la de cliente
 * tiene los dos y la de admin tiene usuario y no cliente. Los almacenes lo llaman en `create`.
 *
 * @param input - Datos de la sesión.
 * @throws {TypeError} En español, si el tipo no es válido o no coincide con `userId`/`customerId`.
 */
export function assertNewSession(input: NewSession): void {
  const { kind, userId, customerId } = input
  if (!Object.hasOwn(SESSION_TTL_SECONDS, kind)) {
    throw new TypeError(`Tipo de sesión desconocido: "${kind}"`)
  }
  const ok =
    kind === 'anonymous'
      ? userId === null && customerId === null
      : kind === 'customer'
        ? isFilled(userId) && isFilled(customerId)
        : isFilled(userId) && customerId === null
  if (!ok) {
    throw new TypeError(
      'Una sesión anónima no lleva usuario ni cliente, una de cliente lleva los dos y una de admin solo el usuario',
    )
  }
}

function isFilled(value: string | null): boolean {
  return value !== null && value.trim() !== ''
}
