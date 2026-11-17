import { Injectable } from '@nestjs/common'

import { isId } from '../../../shared/domain/id'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  AccountMailRecord,
  MailDataReader,
  OrderMailRecord,
  WithdrawalMailRecord,
} from '../application/ports/mail-data.reader.port'
import type { StoreInfo } from '../domain/mail-layout'

/** Texto no vacío de un campo del JSON del vendedor, o `null`. */
function sellerText(seller: unknown, key: string): string | null {
  if (typeof seller !== 'object' || seller === null) return null
  const value = (seller as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Lecturas de los mails con Prisma: pedidos, bandeja, clientes y ajustes (lectura cruzada entre
 * módulos, permitida en un adaptador de infraestructura por la ADR 0001). Un id que no es UUID no
 * existe.
 */
@Injectable()
export class PrismaMailDataReader implements MailDataReader {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc MailDataReader.order} */
  async order(orderId: string): Promise<OrderMailRecord | null> {
    if (!isId(orderId)) return null
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        contactEmail: true,
        contactFirstName: true,
        shippingCostArs: true,
        totalArs: true,
        reservedUntil: true,
        items: {
          orderBy: { position: 'asc' },
          select: { name: true, detail: true, quantity: true, totalArs: true },
        },
      },
    })
    if (row === null) return null
    return {
      number: row.number,
      email: row.contactEmail,
      firstName: row.contactFirstName,
      lines: row.items,
      shippingCostArs: row.shippingCostArs,
      totalArs: row.totalArs,
      reservedUntil: row.reservedUntil,
    }
  }

  /** {@inheritDoc MailDataReader.withdrawal} */
  async withdrawal(messageId: string): Promise<WithdrawalMailRecord | null> {
    if (!isId(messageId)) return null
    const row = await this.prisma.contactMessage.findFirst({
      where: { id: messageId, kind: 'withdrawal' },
      select: { email: true, code: true, orderNumber: true },
    })
    if (row?.code == null) return null
    return { email: row.email, code: row.code, orderNumber: row.orderNumber }
  }

  /** {@inheritDoc MailDataReader.contactEmail} */
  async contactEmail(messageId: string): Promise<string | null> {
    if (!isId(messageId)) return null
    const row = await this.prisma.contactMessage.findFirst({
      where: { id: messageId, kind: 'contact' },
      select: { email: true },
    })
    return row?.email ?? null
  }

  /** {@inheritDoc MailDataReader.account} */
  async account(customerId: string): Promise<AccountMailRecord | null> {
    if (!isId(customerId)) return null
    const row = await this.prisma.customer.findFirst({
      where: { id: customerId, userId: { not: null } },
      select: { email: true, firstName: true },
    })
    return row
  }

  /** {@inheritDoc MailDataReader.storeInfo} */
  async storeInfo(): Promise<Omit<StoreInfo, 'storeOrigin'>> {
    const row = await this.prisma.settings.findUnique({
      where: { id: 1 },
      select: { contactEmail: true, seller: true },
    })
    if (row === null) throw new Error('Faltan los ajustes de la tienda (la fila 1 de settings)')
    return {
      contactEmail: row.contactEmail,
      legalName: sellerText(row.seller, 'legalName'),
      cuit: sellerText(row.seller, 'cuit'),
      address: sellerText(row.seller, 'address'),
    }
  }
}
