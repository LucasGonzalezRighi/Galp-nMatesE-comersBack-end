import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type NewDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  ComboFields,
  ComboRepository,
  StoredCombo,
} from '../application/ports/combo.repository.port'
import type { Product } from '../domain/product.entity'
import { COMBO_INCLUDE, toStoredCombo } from './combo.mapper'
import { PRODUCT_INCLUDE, toProduct } from './product.mapper'

/** Forma de un UUID (`combos.id` y `products.id` son `uuid`: otro texto haría fallar la consulta). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Orden de los listados: por `position` y, a igual posición, por fecha de alta. */
const COMBO_ORDER = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.ComboOrderByWithRelationInput[]

/** Filas de `combo_items` de un combo: cada producto con su lugar (1..n) en `productIds`. */
function itemsOf(comboId: string, fields: ComboFields): Prisma.ComboItemCreateManyInput[] {
  return fields.productIds.map((productId, index) => ({ comboId, position: index + 1, productId }))
}

/** Columnas editables de `combos`. */
function columnsOf(fields: ComboFields): Omit<ComboFields, 'productIds'> {
  return {
    name: fields.name,
    description: fields.description,
    priceArs: fields.priceArs,
    status: fields.status,
  }
}

/**
 * Combos en Postgres (`combos` y `combo_items`), sin caché: los derivados dependen del stock y de
 * los precios vigentes. Cada escritura va en una transacción con su evento `combo.changed` en el
 * outbox; la que no encuentra el combo no guarda nada.
 */
@Injectable()
export class PrismaComboRepository implements ComboRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (el evento de cada escritura va en su transacción).
   * @param clock - Reloj (`occurred_at` del evento).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @inheritdoc */
  async list(): Promise<StoredCombo[]> {
    const rows = await this.prisma.combo.findMany({ include: COMBO_INCLUDE, orderBy: COMBO_ORDER })
    return rows.map(toStoredCombo)
  }

  /** @inheritdoc */
  async findById(id: string): Promise<StoredCombo | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.combo.findUnique({ where: { id }, include: COMBO_INCLUDE })
    return row === null ? null : toStoredCombo(row)
  }

  /** @inheritdoc */
  async findProducts(ids: readonly string[]): Promise<Product[]> {
    const valid = ids.filter((id) => UUID_PATTERN.test(id))
    if (valid.length === 0) return []
    const rows = await this.prisma.product.findMany({
      where: { id: { in: valid } },
      include: PRODUCT_INCLUDE,
    })
    return rows.map(toProduct)
  }

  /** @inheritdoc */
  async listIds(): Promise<string[]> {
    const rows = await this.prisma.combo.findMany({ select: { id: true }, orderBy: COMBO_ORDER })
    return rows.map(({ id }) => id)
  }

  /** @inheritdoc */
  async create(id: string, fields: ComboFields, event: NewDomainEvent): Promise<StoredCombo> {
    await this.prisma.$transaction(async (tx) => {
      const { _max } = await tx.combo.aggregate({ _max: { position: true } })
      await tx.combo.create({
        data: { id, ...columnsOf(fields), position: (_max.position ?? 0) + 1 },
        select: { id: true },
      })
      await tx.comboItem.createMany({ data: itemsOf(id, fields) })
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
    })
    // Se lee después del commit: las relaciones anidadas dentro de la transacción hacen que
    // Prisma mande consultas en paralelo por la misma conexión (pg lo marca como obsoleto).
    const row = await this.prisma.combo.findUniqueOrThrow({ where: { id }, include: COMBO_INCLUDE })
    return toStoredCombo(row)
  }

  /** @inheritdoc */
  async update(
    id: string,
    fields: ComboFields,
    event: NewDomainEvent,
  ): Promise<StoredCombo | null> {
    if (!UUID_PATTERN.test(id)) return null
    const updated = await this.prisma.$transaction(async (tx) => {
      // `updateMany` bloquea la fila y, si el combo ya no está, no falla: devuelve 0.
      const { count } = await tx.combo.updateMany({ where: { id }, data: columnsOf(fields) })
      if (count === 0) return false
      await tx.comboItem.deleteMany({ where: { comboId: id } })
      await tx.comboItem.createMany({ data: itemsOf(id, fields) })
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return true
    })
    // Después del commit, como en `create`.
    return updated ? this.findById(id) : null
  }

  /** @inheritdoc */
  async delete(id: string, event: NewDomainEvent): Promise<boolean> {
    if (!UUID_PATTERN.test(id)) return false
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.combo.deleteMany({ where: { id } })
      if (count === 0) return false
      const rest = await tx.combo.findMany({
        select: { id: true, position: true },
        orderBy: COMBO_ORDER,
      })
      for (const [index, combo] of rest.entries()) {
        if (combo.position !== index + 1) {
          await tx.combo.update({ where: { id: combo.id }, data: { position: index + 1 } })
        }
      }
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return true
    })
  }

  /** @inheritdoc */
  async reorder(ids: readonly string[], event: NewDomainEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        if (!UUID_PATTERN.test(id)) continue
        await tx.combo.updateMany({ where: { id }, data: { position: index + 1 } })
      }
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
    })
  }
}
