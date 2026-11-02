/** Tipos de cambio de un {@link ChangeNotice} (enum `ChangeNotice.kind` del contrato). */
export const CHANGE_KINDS = ['price', 'stock', 'discount', 'shipping', 'unavailable'] as const

/** Qué cambió entre que el cliente armó el pedido y que se confirmó. */
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * Aviso de un cambio (`ChangeNotice` del contrato): va en `changes` de los 409 de pedidos, por
 * ejemplo `{ kind: 'stock', productId, message: 'Quedan 2 unidades de Mate Imperial.' }`.
 */
export interface ChangeNotice {
  /** Qué cambió. */
  kind: ChangeKind
  /** Producto afectado, o `null` si el cambio no es de un producto (envío, descuento o total). */
  productId: string | null
  /** Explicación del cambio, en español. */
  message: string
}

/** Error de validación de un campo (`FieldError` del contrato): va en `errors` de los 422. */
export interface FieldError {
  /** Ruta del campo con puntos, por ejemplo `customer.email`. */
  field: string
  /** Código estable en `snake_case`, por ejemplo `too_small`. */
  code: string
  /** Mensaje en español para mostrarle a la persona. */
  message: string
}

/**
 * Indica si un texto es un tipo de cambio del contrato.
 *
 * @param value - Texto a revisar.
 * @returns `true` si es un {@link ChangeKind}.
 */
export function isChangeKind(value: string): value is ChangeKind {
  return (CHANGE_KINDS as readonly string[]).includes(value)
}
