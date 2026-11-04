import type { Clock } from '../../../../shared/domain/clock'
import type { ExpireOrdersCommand } from '../../../orders/application/commands/expire-orders.command'
import { buildPaymentAlerts, type PaymentAlert } from '../../domain/payment-alerts'
import type {
  DashboardReader,
  DashboardSnapshot,
  LowStockProduct,
} from '../ports/dashboard-reader.port'

/** Resumen del inicio del dashboard, con la forma de `DashboardSummary` del contrato. */
export interface DashboardSummaryView {
  /** Total vendido hoy (día de Buenos Aires). */
  salesTodayArs: number
  /** Total vendido en los últimos 7 días, hoy incluido. */
  salesLast7DaysArs: number
  /** Pedidos pagados o en preparación. */
  ordersToShip: number
  /** Publicados con poco stock disponible. */
  lowStock: LowStockProduct[]
  /** Reseñas pendientes de moderación. */
  pendingReviews: number
  /** Mensajes de la bandeja sin leer. */
  unreadMessages: number
  /** Alertas de pago, del pedido más nuevo al más viejo. */
  paymentAlerts: PaymentAlert[]
}

/** Revisa que una cifra del resumen sea un entero no negativo (el contrato pide `minimum: 0`). */
function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `La cifra ${name} del resumen tiene que ser un entero no negativo (llegó ${String(value)}).`,
    )
  }
}

/** Revisa las cifras que llegan del lector antes de devolverlas. */
function assertSnapshot(snapshot: DashboardSnapshot): void {
  assertCount('salesTodayArs', snapshot.salesTodayArs)
  assertCount('salesLast7DaysArs', snapshot.salesLast7DaysArs)
  assertCount('ordersToShip', snapshot.ordersToShip)
  assertCount('pendingReviews', snapshot.pendingReviews)
  assertCount('unreadMessages', snapshot.unreadMessages)
  for (const product of snapshot.lowStock) assertCount('lowStock.stock', product.stock)
}

/**
 * Resumen del inicio del dashboard (`GET /admin/dashboard/summary`, Ruling B-78): primero vence
 * los pedidos atrasados (así sus reservas ya no restan stock), después lee las cifras con la hora
 * del reloj y arma las alertas de pago. Solo lee: no avisa nada a la tienda.
 */
export class GetDashboardSummaryQuery {
  /**
   * @param reader - Lector de las cifras.
   * @param expire - Vencimiento de los pedidos atrasados antes de leer.
   * @param clock - Reloj de la app (define "hoy").
   */
  constructor(
    private readonly reader: DashboardReader,
    private readonly expire: Pick<ExpireOrdersCommand, 'expireDue'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @returns El resumen, con las claves en el orden del contrato.
   * @throws {RangeError} En español, si el lector devuelve una cifra que no es un entero no
   *   negativo o un monto inválido para un mensaje.
   * @throws {TypeError} En español, si un pedido con alertas llega sin número o sin fecha válida.
   */
  async execute(): Promise<DashboardSummaryView> {
    // Si algún pedido no se pudo vencer, el resumen sale igual: el barrido lo reintenta.
    await this.expire.expireDue()
    const snapshot = await this.reader.read(this.clock.now())
    assertSnapshot(snapshot)
    return {
      salesTodayArs: snapshot.salesTodayArs,
      salesLast7DaysArs: snapshot.salesLast7DaysArs,
      ordersToShip: snapshot.ordersToShip,
      lowStock: snapshot.lowStock.map(({ id, name, stock }) => ({ id, name, stock })),
      pendingReviews: snapshot.pendingReviews,
      unreadMessages: snapshot.unreadMessages,
      paymentAlerts: buildPaymentAlerts(snapshot.paymentIssues),
    }
  }
}
