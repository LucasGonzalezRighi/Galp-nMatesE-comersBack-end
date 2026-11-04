import { formatPesos } from '../../../shared/domain/format-pesos'

/** Tipos de alerta de pago del resumen (`DashboardSummary.paymentAlerts[].kind`), como el contrato. */
export const PAYMENT_ALERT_KINDS = ['charged_back', 'in_dispute', 'duplicate_payment'] as const

/** Tipo de alerta de pago: contracargo, mediación abierta o un pago de más para devolver. */
export type PaymentAlertKind = (typeof PAYMENT_ALERT_KINDS)[number]

/** Alerta de pago de un pedido, como la muestra el inicio del dashboard. */
export interface PaymentAlert {
  /** Número del pedido (`GLP-` y cinco dígitos). */
  orderNumber: string
  /** Qué pasó. */
  kind: PaymentAlertKind
  /** Explicación para mostrar, en español. */
  message: string
}

/** Pedido con algo de pago para mirar: lo que hace falta para armar sus alertas. */
export interface PaymentIssue {
  /** Número del pedido (`GLP-` y cinco dígitos). */
  orderNumber: string
  /** Estado del pago del pedido (`orders.payment_status`). */
  paymentStatus: string
  /** Total del pedido, en pesos enteros. */
  totalArs: number
  /** Cuándo se creó el pedido. */
  createdAt: Date
  /**
   * Monto de cada devolución sin aprobar del pedido (pendiente o fallida, por cualquier motivo),
   * en pesos enteros y en el orden en que se crearon.
   */
  unsettledRefundsArs: readonly number[]
}

/**
 * Texto de una alerta, literal del mock (`handlers/admin-orders.ts`).
 *
 * @param kind - Tipo de alerta.
 * @param amountArs - El total del pedido (contracargo y mediación) o lo que hay que devolver
 *   (duplicado).
 * @returns El mensaje para el dashboard.
 * @throws {RangeError} En español, si el monto no es un entero no negativo.
 */
export function paymentAlertMessage(kind: PaymentAlertKind, amountArs: number): string {
  const amount = formatPesos(amountArs)
  switch (kind) {
    case 'charged_back':
      return `Contracargo por ${amount}: el cliente desconoció el pago. Revisalo en Mercado Pago.`
    case 'in_dispute':
      return `Mediación abierta por ${amount}. Respondé desde Mercado Pago.`
    case 'duplicate_payment':
      return `Se aprobó un segundo pago de ${amount}. Devolvelo desde Mercado Pago.`
  }
}

/** Del pedido más nuevo al más viejo; a igual fecha, el número más alto primero. */
function newestFirst(a: PaymentIssue, b: PaymentIssue): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime()
  if (byDate !== 0) return byDate
  if (a.orderNumber === b.orderNumber) return 0
  return a.orderNumber < b.orderNumber ? 1 : -1
}

/** Revisa lo que no puede faltar de un pedido (los montos los revisa `formatPesos`). */
function assertIssue(issue: PaymentIssue): void {
  if (typeof issue.orderNumber !== 'string' || issue.orderNumber.trim() === '') {
    throw new TypeError('El número de pedido de una alerta de pago no puede estar vacío.')
  }
  if (!(issue.createdAt instanceof Date) || Number.isNaN(issue.createdAt.getTime())) {
    throw new TypeError(`La fecha del pedido ${issue.orderNumber} no es válida.`)
  }
  if (!Array.isArray(issue.unsettledRefundsArs)) {
    throw new TypeError(
      `Las devoluciones del pedido ${issue.orderNumber} tienen que ser una lista de montos.`,
    )
  }
}

/**
 * Alertas de pago del resumen (Ruling B-78): los pedidos van del más nuevo al más viejo (a igual
 * fecha, por número de mayor a menor) y, en cada uno, primero el contracargo o la mediación según
 * el estado del pago del pedido y después un `duplicate_payment` por cada devolución sin aprobar,
 * en el orden recibido. Es la única alerta de devolución del contrato, así que cubre cualquier
 * motivo (un segundo pago, uno que llegó tarde o una devolución manual que falló).
 *
 * @param issues - Pedidos con un contracargo, una mediación o devoluciones sin aprobar (los que no
 *   tienen nada de eso no dan alertas). No se modifica.
 * @returns Las alertas en el orden del dashboard.
 * @throws {TypeError} En español, si un pedido no tiene número, fecha válida o lista de
 *   devoluciones.
 * @throws {RangeError} En español, si un monto que va en un mensaje no es un entero no negativo.
 */
export function buildPaymentAlerts(issues: readonly PaymentIssue[]): PaymentAlert[] {
  issues.forEach(assertIssue)
  const alerts: PaymentAlert[] = []
  const add = (orderNumber: string, kind: PaymentAlertKind, amountArs: number): void => {
    alerts.push({ orderNumber, kind, message: paymentAlertMessage(kind, amountArs) })
  }
  for (const issue of [...issues].sort(newestFirst)) {
    if (issue.paymentStatus === 'charged_back' || issue.paymentStatus === 'in_dispute') {
      add(issue.orderNumber, issue.paymentStatus, issue.totalArs)
    }
    for (const amountArs of issue.unsettledRefundsArs) {
      add(issue.orderNumber, 'duplicate_payment', amountArs)
    }
  }
  return alerts
}
