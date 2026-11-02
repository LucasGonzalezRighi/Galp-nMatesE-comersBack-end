/** Página de una lista (forma de las listas paginadas del contrato). */
export interface Page<T> {
  /** Los elementos de esta página. */
  items: T[]
  /** Número de página, desde 1. */
  page: number
  /** Elementos por página pedidos (1–100). */
  pageSize: number
  /** Total de elementos de la lista completa. */
  total: number
}
