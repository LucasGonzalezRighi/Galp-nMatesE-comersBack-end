import type { PaymentIssue } from '../../domain/payment-alerts'

/** Token de inyección del lector del resumen. */
export const DASHBOARD_READER = Symbol('DASHBOARD_READER')

/** Zona horaria en la que se cuentan los días de las ventas (el "hoy" del dashboard). */
export const SALES_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Producto publicado con poco stock. */
export interface LowStockProduct {
  /** Id del producto. */
  id: string
  /** Nombre del producto. */
  name: string
  /** Unidades disponibles (`on_hand − reserved`; sin fila de inventario, 0). */
  stock: number
}

/** Cifras del inicio del dashboard tal como están en la base, antes de armar las alertas. */
export interface DashboardSnapshot {
  /** Suma de `total_ars` de los pedidos vendidos con `paid_at` de hoy en Buenos Aires. */
  salesTodayArs: number
  /** Lo mismo, de hoy y los 6 días anteriores. */
  salesLast7DaysArs: number
  /** Pedidos pagados o en preparación. */
  ordersToShip: number
  /**
   * Publicados con disponible menor o igual al umbral de los ajustes, por disponible y después por
   * nombre (orden del español).
   */
  lowStock: LowStockProduct[]
  /** Reseñas pendientes de moderación. */
  pendingReviews: number
  /** Mensajes de la bandeja sin leer. */
  unreadMessages: number
  /** Pedidos con contracargo, mediación o devoluciones sin aprobar. */
  paymentIssues: PaymentIssue[]
}

/**
 * Lectura del resumen (Ruling B-78): solo lee, directo de Postgres y sin caché (las tablas son de
 * otros módulos; ADR 0001 permite la lectura cruzada en un adaptador).
 */
export interface DashboardReader {
  /**
   * @param now - Hora actual, del reloj de la app: define "hoy" en {@link SALES_TIME_ZONE}.
   * @returns Las cifras del resumen.
   */
  read(now: Date): Promise<DashboardSnapshot>
}
