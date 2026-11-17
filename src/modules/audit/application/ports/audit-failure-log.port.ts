/**
 * Dónde queda el aviso de que la auditoría de una escritura falló. En infraestructura es un
 * `Logger` de Nest. Nunca recibe el cuerpo del pedido ni el mensaje del error (el de Prisma puede
 * traer los datos de la consulta): solo la acción, la entidad y el nombre y el código del error.
 */
export interface AuditFailureLog {
  /**
   * @param message - Aviso en español, sin datos del pedido.
   */
  error(message: string): void
}
