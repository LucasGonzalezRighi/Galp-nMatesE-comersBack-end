/**
 * Cupo diario de reseñas pendientes por IP real del cliente (NV-21): cada reseña nueva cuenta, y
 * pasado el cupo se rechaza hasta que se libera.
 */
export interface ReviewQuotaPort {
  /**
   * Cuenta una reseña nueva de esa IP y dice si entra en el cupo.
   *
   * @param clientIp - IP real del cliente (no vacía).
   * @returns `null` si entra; si no, los segundos que faltan para que se libere el cupo.
   */
  take(clientIp: string): Promise<number | null>
}

/** Token de inyección del {@link ReviewQuotaPort}. */
export const REVIEW_QUOTA_PORT = Symbol('REVIEW_QUOTA_PORT')
