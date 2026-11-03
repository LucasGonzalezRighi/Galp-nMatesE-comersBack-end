/** La tienda regeneró las etiquetas. */
export interface StorefrontRevalidated {
  kind: 'revalidated'
  /** Etiquetas pedidas. */
  tags: string[]
}

/** La tienda rechazó el pedido para siempre (secreto o etiqueta inválidos): reintentar no sirve. */
export interface StorefrontRejected {
  kind: 'rejected'
  /** Estado HTTP de la respuesta (4xx). */
  status: number
  /** El `error` del cuerpo de la tienda, o un texto genérico si no vino. */
  reason: string
}

/** Resultado de pedirle a la tienda que regenere etiquetas. */
export type StorefrontRevalidation = StorefrontRevalidated | StorefrontRejected

/** Token de inyección de {@link StorefrontPort}. */
export const STOREFRONT_PORT = Symbol('STOREFRONT_PORT')

/** La tienda (Next.js), vista desde el back: solo se le avisa qué páginas regenerar. */
export interface StorefrontPort {
  /**
   * Le pide a la tienda que regenere las etiquetas de caché.
   *
   * @param tags - De 1 a 50 etiquetas válidas para la tienda.
   * @returns Si las regeneró o si rechazó el pedido para siempre.
   * @throws Si la falla es pasajera (tienda caída, 5xx, 408, 429 o timeout): se reintenta.
   */
  revalidate(tags: readonly string[]): Promise<StorefrontRevalidation>
}
