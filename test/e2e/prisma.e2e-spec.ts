import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Prisma } from '../../src/generated/prisma/client'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

describe('prisma', () => {
  let containers: TestContainers | undefined
  let app: INestApplication | undefined

  /** El `PrismaService` de la app; falla claro si `beforeAll` no llegó a crearla. */
  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no se creó en beforeAll')
    return app.get(PrismaService)
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
  })

  it('se conecta a la base migrada y vacía', async () => {
    expect(await prisma().category.count()).toBe(0)
    expect(await prisma().$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }])
  })

  it('la migración crea la extensión citext y el índice parcial del outbox', async () => {
    const extensions = await prisma().$queryRaw<
      { extname: string }[]
    >`SELECT extname FROM pg_extension WHERE extname = 'citext'`
    expect(extensions).toHaveLength(1)

    const indexes = await prisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'outbox_events'
        AND indexdef LIKE '%WHERE (published_at IS NULL)%'`
    expect(indexes).toHaveLength(1)
  })

  it('los CHECK escritos a mano rechazan stock, puntajes y ajustes inválidos', async () => {
    const db = prisma()
    const category = await db.category.create({
      data: { slug: 'imperiales', name: 'Imperiales', group: 'mate', blurb: 'B', position: 1 },
    })
    const product = await db.product.create({
      data: { slug: 'mate-x', categoryId: category.id, name: 'Mate X', description: 'D' },
    })
    const productId = product.id

    await expect(
      db.inventory.create({ data: { productId, onHand: 1, reserved: 2 } }),
    ).rejects.toThrow(/inventory_reserved_check/)
    await expect(
      db.inventory.create({ data: { productId, onHand: 1, reserved: -1 } }),
    ).rejects.toThrow(/inventory_reserved_check/)
    await expect(
      db.inventory.create({ data: { productId, onHand: 2, reserved: 2 } }),
    ).resolves.toMatchObject({ onHand: 2, reserved: 2, version: 0 })

    const review = { productId, authorName: 'Martina R.', text: 'Muy lindo' }
    for (const rating of [0.5, 4.3, 5.5]) {
      await expect(db.review.create({ data: { ...review, rating } })).rejects.toThrow(
        /reviews_rating_check/,
      )
    }
    const half = await db.review.create({ data: { ...review, rating: 4.5 } })
    expect(half.rating.toString()).toBe('4.5')
    expect(half.status).toBe('pending')

    const settings = {
      kitDiscountPercent: 10,
      installmentsMax: 3,
      installmentsShowOnProduct: true,
      contactEmail: 'galpon.mates@gmail.com',
      lowStockThreshold: 3,
      vatRatePercent: 10.5,
      showNetPrice: true,
      seller: { legalName: null },
    }
    await expect(db.settings.create({ data: { ...settings, id: 2 } })).rejects.toThrow(
      /settings_singleton_check/,
    )
    const saved = await db.settings.create({ data: settings })
    expect(saved.id).toBe(1)
    expect(saved.vatRatePercent.toString()).toBe('10.5')

    const second = await db.product.create({
      data: { slug: 'mate-y', categoryId: category.id, name: 'Mate Y', description: 'D' },
    })
    expect(second.sequence).toBe(product.sequence + 1)
  })

  it('los emails de usuarios y clientes son citext', async () => {
    const columns = await prisma().$queryRaw<
      { table_name: string; data_type: string; udt_name: string }[]
    >`
      SELECT table_name, data_type, udt_name FROM information_schema.columns
        WHERE table_name IN ('users', 'customers') AND column_name = 'email'
        ORDER BY table_name`
    expect(columns).toEqual([
      { table_name: 'customers', data_type: 'USER-DEFINED', udt_name: 'citext' },
      { table_name: 'users', data_type: 'USER-DEFINED', udt_name: 'citext' },
    ])

    const db = prisma()
    await db.user.create({ data: { email: 'ana@mail.com', passwordHash: 'h', role: 'customer' } })
    await expect(
      db.user.create({ data: { email: 'ANA@Mail.com', passwordHash: 'h', role: 'customer' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(await db.user.findUnique({ where: { email: 'Ana@MAIL.com' } })).toMatchObject({
      email: 'ana@mail.com',
      status: 'active',
      emailVerifiedAt: null,
      lastLoginAt: null,
    })
  })

  it('una sola dirección predeterminada por cliente (índice único parcial)', async () => {
    const indexes = await prisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
        WHERE tablename = 'addresses' AND indexname = 'addresses_default_per_customer_idx'`
    expect(indexes).toHaveLength(1)
    expect(indexes[0]?.indexdef).toContain('UNIQUE')
    expect(indexes[0]?.indexdef).toMatch(/WHERE \(?is_default\)?$/)

    const db = prisma()
    const customer = await db.customer.create({
      data: { email: 'beto@mail.com', firstName: 'Beto', lastName: 'Gómez' },
    })
    const address = {
      customerId: customer.id,
      street: 'Av. Siempre Viva',
      number: '742',
      postalCode: 'C1425',
      city: 'CABA',
      province: 'caba',
    } as const
    await db.address.create({ data: { ...address, isDefault: true } })
    await db.address.create({ data: { ...address, label: 'Trabajo' } })
    await db.address.create({ data: { ...address, label: 'Casa de mamá' } })
    await expect(
      db.address.create({ data: { ...address, isDefault: true } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(await db.address.count({ where: { customerId: customer.id } })).toBe(3)

    const other = await db.customer.create({
      data: { email: 'carla@mail.com', firstName: 'Carla', lastName: 'Paz' },
    })
    await expect(
      db.address.create({
        data: { ...address, customerId: other.id, province: 'cordoba', isDefault: true },
      }),
    ).resolves.toMatchObject({ isDefault: true, province: 'cordoba' })
    const [row] = await db.$queryRaw<{ province: string }[]>`
      SELECT province::text FROM addresses WHERE customer_id = ${other.id}::uuid`
    expect(row?.province).toBe('Córdoba')
  })

  it('borrar un cliente o un usuario deja en null las reseñas, los contenidos y el vínculo', async () => {
    const db = prisma()
    const user = await db.user.create({
      data: { email: 'dani@mail.com', passwordHash: 'h', role: 'admin' },
    })
    const customer = await db.customer.create({
      data: { userId: user.id, email: 'dani@mail.com', firstName: 'Dani', lastName: 'Ruiz' },
    })
    const category = await db.category.create({
      data: { slug: 'torpedos', name: 'Torpedos', group: 'mate', blurb: 'B', position: 2 },
    })
    const product = await db.product.create({
      data: { slug: 'mate-z', categoryId: category.id, name: 'Mate Z', description: 'D' },
    })
    const review = await db.review.create({
      data: {
        productId: product.id,
        customerId: customer.id,
        authorName: 'Dani R.',
        rating: 5,
        text: 'Hermoso',
      },
    })
    await db.contentBlock.create({ data: { key: 'faq', data: {}, updatedBy: user.id } })
    const token = await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: 'abc', expiresAt: new Date(Date.now() + 3_600_000) },
    })
    expect(token.usedAt).toBeNull()

    await db.user.delete({ where: { id: user.id } })
    expect(await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({
      userId: null,
    })
    expect(await db.contentBlock.findUniqueOrThrow({ where: { key: 'faq' } })).toMatchObject({
      updatedBy: null,
    })
    expect(await db.passwordResetToken.count()).toBe(0)

    await db.address.create({
      data: {
        customerId: customer.id,
        street: 'San Martín',
        number: '100',
        postalCode: 'X5000',
        city: 'Córdoba',
        province: 'cordoba',
      },
    })
    await db.customer.delete({ where: { id: customer.id } })
    expect(await db.review.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({
      customerId: null,
    })
    expect(await db.address.count({ where: { customerId: customer.id } })).toBe(0)
  })

  /**
   * Datos de un pedido que pasa el CHECK de totales: subtotal = bruto − ahorro de kits y total =
   * subtotal + envío. El hash del token sale del número, así cada pedido tiene uno distinto.
   */
  function orderData(
    number: string,
    customerId: string | null = null,
  ): Prisma.OrderUncheckedCreateInput {
    return {
      number,
      customerId,
      paymentMethod: 'mp_redirect',
      contactEmail: 'ana@mail.com',
      contactFirstName: 'Ana',
      contactLastName: 'Pérez',
      contactPhone: '1155551234',
      shippingMethod: 'home',
      shippingAddress: {
        street: 'Av. Siempre Viva',
        number: '742',
        apartment: null,
        postalCode: 'C1425',
        city: 'CABA',
        province: 'CABA',
      },
      shippingCostArs: 6500,
      shippingEta: '3 a 6 días hábiles',
      itemsGrossArs: 151994,
      kitSavingsArs: 15200,
      subtotalArs: 136794,
      totalArs: 143294,
      kitDiscountPercent: 10,
      accessTokenHash: `hash-${number}`,
      reservedUntil: new Date(Date.now() + 30 * 60_000),
    }
  }

  it('la migración b4 crea las tablas de pedidos, la secuencia GLP- y los índices de vencimiento', async () => {
    const db = prisma()
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('orders', 'order_items',
          'order_item_components', 'order_status_history', 'shipments', 'stock_reservations')`
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      'order_item_components',
      'order_items',
      'order_status_history',
      'orders',
      'shipments',
      'stock_reservations',
    ])

    const sequences = await db.$queryRaw<
      { start: number; min: number; max: number; cycle: boolean }[]
    >`
      SELECT start_value::int AS start, min_value::int AS min, max_value::int AS max, cycle
        FROM pg_sequences WHERE sequencename = 'order_number_seq'`
    expect(sequences).toEqual([{ start: 10001, min: 10001, max: 99999, cycle: false }])
    expect(await db.$queryRaw`SELECT nextval('order_number_seq')::int AS n`).toEqual([{ n: 10001 }])
    expect(await db.$queryRaw`SELECT nextval('order_number_seq')::int AS n`).toEqual([{ n: 10002 }])
    // Al llegar a 99999 falla en vez de dar la vuelta: nunca se repite un número.
    await db.$queryRaw`SELECT setval('order_number_seq', 99999)`
    await expect(db.$queryRaw`SELECT nextval('order_number_seq')`).rejects.toThrow(/maximum value/)
    await db.$queryRaw`SELECT setval('order_number_seq', 10001, false)`

    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname IN
        ('orders_status_reserved_until_idx', 'stock_reservations_status_expires_at_idx',
          'orders_customer_id_placed_at_idx', 'order_status_history_order_id_created_at_idx')`
    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      'order_status_history_order_id_created_at_idx',
      'orders_customer_id_placed_at_idx',
      'orders_status_reserved_until_idx',
      'stock_reservations_status_expires_at_idx',
    ])
  })

  it('los CHECK de pedidos rechazan cantidades fuera de rango y totales que no cierran', async () => {
    const db = prisma()
    const category = await db.category.create({
      data: { slug: 'camioneros', name: 'Camioneros', group: 'mate', blurb: 'B', position: 3 },
    })
    const product = await db.product.create({
      data: {
        slug: 'mate-pedido',
        categoryId: category.id,
        name: 'Mate pedido',
        description: 'D',
        priceArs: 39999,
      },
    })

    const base = orderData('GLP-10001')
    await expect(
      db.order.create({ data: { ...base, totalArs: base.totalArs + 1 } }),
    ).rejects.toThrow(/orders_totals_check/)
    await expect(
      db.order.create({
        data: { ...base, subtotalArs: base.subtotalArs - 1, totalArs: base.totalArs - 1 },
      }),
    ).rejects.toThrow(/orders_totals_check/)
    const order = await db.order.create({ data: base })
    expect(order).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'none',
      customerId: null,
      paidAt: null,
      cancelledAt: null,
    })

    const item = {
      orderId: order.id,
      lineType: 'product',
      productId: product.id,
      productSlug: 'mate-pedido',
      name: 'Mate pedido',
      detail: 'Cuero negro · Alpaca cincelada',
      unitPriceArs: 39999,
      kitSavingsArs: 0,
      options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
      position: 1,
    } as const
    for (const quantity of [0, 21]) {
      await expect(
        db.orderItem.create({ data: { ...item, quantity, totalArs: 39999 * quantity } }),
      ).rejects.toThrow(/order_items_quantity_check/)
    }
    await expect(
      db.orderItem.create({ data: { ...item, quantity: 20, totalArs: 799980 } }),
    ).resolves.toMatchObject({ quantity: 20, lineType: 'product' })

    const reservation = { orderId: order.id, productId: product.id, expiresAt: order.reservedUntil }
    await expect(
      db.stockReservation.create({ data: { ...reservation, quantity: 0 } }),
    ).rejects.toThrow(/stock_reservations_quantity_check/)
    await expect(
      db.stockReservation.create({ data: { ...reservation, quantity: 20 } }),
    ).resolves.toMatchObject({ quantity: 20, status: 'active' })
  })

  it('borrar un pedido arrastra lo suyo y deja la reseña sin ítem; lo vendido no se borra', async () => {
    const db = prisma()
    const fks = await db.$queryRaw<{ constraint_name: string }[]>`
      SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'reviews' AND constraint_type = 'FOREIGN KEY'
          AND constraint_name LIKE '%order_item%'`
    expect(fks).toHaveLength(1)

    const product = await db.product.findUniqueOrThrow({ where: { slug: 'mate-pedido' } })
    const customer = await db.customer.create({
      data: { email: 'eli@mail.com', firstName: 'Eli', lastName: 'Sosa' },
    })
    const order = await db.order.create({ data: orderData('GLP-10002', customer.id) })
    const kit = await db.orderItem.create({
      data: {
        orderId: order.id,
        lineType: 'kit',
        productId: null,
        productSlug: null,
        name: 'Kit',
        detail: 'Mate pedido + Bombilla + Yerba · Cuero negro',
        quantity: 2,
        unitPriceArs: 75997,
        kitSavingsArs: 15200,
        totalArs: 136794,
        options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
        position: 1,
        components: {
          create: [
            {
              role: 'mate',
              productId: product.id,
              slug: 'mate-pedido',
              name: 'Mate pedido',
              unitPriceArs: 39999,
            },
          ],
        },
      },
    })
    await db.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: null, toStatus: 'pending_payment', actor: 'customer' },
    })
    await db.shipment.create({
      data: { orderId: order.id, carrier: 'Andreani', trackingNumber: 'AND123456' },
    })
    await db.stockReservation.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 2,
        expiresAt: order.reservedUntil,
      },
    })
    const review = await db.review.create({
      data: {
        productId: product.id,
        orderItemId: kit.id,
        authorName: 'Eli S.',
        rating: 5,
        text: 'Llegó perfecto',
      },
    })

    await expect(db.product.delete({ where: { id: product.id } })).rejects.toMatchObject({
      code: 'P2003',
    })

    await db.customer.delete({ where: { id: customer.id } })
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      customerId: null,
    })

    await db.order.delete({ where: { id: order.id } })
    const ofOrder = { where: { orderId: order.id } }
    expect(await db.orderItem.count(ofOrder)).toBe(0)
    expect(await db.orderItemComponent.count({ where: { orderItemId: kit.id } })).toBe(0)
    expect(await db.orderStatusHistory.count(ofOrder)).toBe(0)
    expect(await db.shipment.count(ofOrder)).toBe(0)
    expect(await db.stockReservation.count(ofOrder)).toBe(0)
    expect(await db.review.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({
      orderItemId: null,
    })
  })

  it('la migración b5 crea pagos, devoluciones y eventos de webhook con sus enums', async () => {
    const db = prisma()
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('payments', 'refunds', 'webhook_events')`
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      'payments',
      'refunds',
      'webhook_events',
    ])

    const enums = await db.$queryRaw<{ name: string; labels: string }[]>`
      SELECT t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('payment_provider', 'refund_status', 'refund_reason')
        GROUP BY t.typname ORDER BY t.typname`
    expect(enums).toEqual([
      { name: 'payment_provider', labels: 'mercadopago' },
      { name: 'refund_reason', labels: 'duplicate_payment,late_approval,manual' },
      { name: 'refund_status', labels: 'pending,approved,failed' },
    ])

    const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('payments', 'webhook_events')
        ORDER BY indexname`
    expect(indexes.map((i) => i.indexname)).toEqual([
      'payments_active_per_order_idx',
      'payments_idempotency_key_key',
      'payments_order_id_created_at_idx',
      'payments_pkey',
      'payments_provider_preference_id_idx',
      'payments_provider_provider_payment_id_key',
      'webhook_events_pkey',
      'webhook_events_processed_at_idx',
      'webhook_events_provider_event_id_key',
    ])
    const active = indexes.find((i) => i.indexname === 'payments_active_per_order_idx')
    expect(active?.indexdef).toContain('UNIQUE')
    expect(active?.indexdef).toMatch(/\(order_id\) WHERE \(?is_active\)?$/)
  })

  it('un solo intento de pago activo por pedido; claves e ids de Mercado Pago únicos', async () => {
    const db = prisma()
    const order = await db.order.create({ data: orderData('GLP-10003') })
    const attempt = { orderId: order.id, method: 'card', amountArs: order.totalArs } as const

    const first = await db.payment.create({
      data: { ...attempt, idempotencyKey: 'clave-1', providerPaymentId: '1234567890' },
    })
    expect(first).toMatchObject({
      provider: 'mercadopago',
      status: 'none',
      isActive: true,
      refundedArs: 0,
      providerStatus: null,
      initPoint: null,
      challengeUrl: null,
      approvedAt: null,
    })

    // Dos intentos activos del mismo pedido: lo frena el índice único parcial.
    await expect(
      db.payment.create({ data: { ...attempt, idempotencyKey: 'clave-2' } }),
    ).rejects.toThrow(/payments_active_per_order_idx/)

    // Los inactivos no cuentan: con el primero inactivo entra otro activo y cualquier inactivo.
    await db.payment.update({
      where: { id: first.id },
      data: { isActive: false, status: 'rejected' },
    })
    const second = await db.payment.create({ data: { ...attempt, idempotencyKey: 'clave-2' } })
    await db.payment.create({ data: { ...attempt, idempotencyKey: 'clave-3', isActive: false } })
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(3)

    // La clave idempotente y el par (proveedor, id del pago en MP) no se repiten; sin id de MP
    // (varios null) sí.
    await expect(
      db.payment.create({ data: { ...attempt, idempotencyKey: 'clave-1', isActive: false } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      db.payment.update({ where: { id: second.id }, data: { providerPaymentId: '1234567890' } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const refund = await db.refund.create({
      data: {
        paymentId: first.id,
        amountArs: first.amountArs,
        reason: 'duplicate_payment',
        idempotencyKey: 'devolucion-1',
      },
    })
    expect(refund).toMatchObject({ status: 'pending', providerRefundId: null, lastError: null })
    await expect(
      db.refund.create({
        data: {
          paymentId: first.id,
          amountArs: 1,
          reason: 'manual',
          idempotencyKey: 'devolucion-1',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // Borrar el pedido arrastra sus intentos y las devoluciones de esos intentos.
    await db.order.delete({ where: { id: order.id } })
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(0)
    expect(await db.refund.count({ where: { paymentId: first.id } })).toBe(0)
  })

  it('un evento de webhook se registra una sola vez por proveedor e id', async () => {
    const db = prisma()
    const event = {
      provider: 'mercadopago',
      eventId: '12345',
      type: 'payment',
      action: 'payment.updated',
      resourceId: '1234567890',
      signatureValid: true,
      payload: { id: 12345, type: 'payment', data: { id: '1234567890' } },
    } as const
    const saved = await db.webhookEvent.create({ data: event })
    expect(saved).toMatchObject({ attempts: 0, processedAt: null, lastError: null })
    expect(saved.receivedAt).toBeInstanceOf(Date)
    await expect(db.webhookEvent.create({ data: event })).rejects.toMatchObject({ code: 'P2002' })
  })

  /**
   * Línea y mate propios de un caso de combos (slugs con `key`), así cada `it` crea lo que usa.
   *
   * @param key - Sufijo de los slugs, distinto en cada caso.
   */
  async function comboCatalog(key: string) {
    const db = prisma()
    const category = await db.category.create({
      data: { slug: `linea-${key}`, name: `Línea ${key}`, group: 'mate', blurb: 'B', position: 9 },
    })
    const mate = await db.product.create({
      data: { slug: `mate-${key}`, categoryId: category.id, name: `Mate ${key}`, description: 'D' },
    })
    return { category, mate }
  }

  it('la migración b5c crea combos y sus piezas, y suma combo a line_type', async () => {
    const db = prisma()
    const lineTypes = await db.$queryRaw<
      { value: string }[]
    >`SELECT unnest(enum_range(NULL::line_type))::text AS value`
    expect(lineTypes.map((t) => t.value)).toEqual(['product', 'kit', 'combo'])
    const comboStatuses = await db.$queryRaw<
      { value: string }[]
    >`SELECT unnest(enum_range(NULL::combo_status))::text AS value`
    expect(comboStatuses.map((s) => s.value)).toEqual(['draft', 'published'])

    const { mate: product } = await comboCatalog('combo')
    const order = await db.order.create({ data: orderData('GLP-10010') })
    const line = await db.orderItem.create({
      data: {
        orderId: order.id,
        lineType: 'combo',
        productId: null,
        productSlug: null,
        name: 'Dúo Imperial',
        detail: 'Mate combo + Bombillón',
        quantity: 1,
        unitPriceArs: 68998,
        kitSavingsArs: 6999,
        totalArs: 61999,
        options: { leather: 'Negro', ferrule: 'Acero' },
        position: 1,
        components: {
          create: [
            {
              role: 'mate',
              productId: product.id,
              slug: 'mate-combo',
              name: 'Mate combo',
              unitPriceArs: 39999,
            },
          ],
        },
      },
      include: { components: true },
    })
    expect(line.lineType).toBe('combo')
    // Sin `position` explícita una pieza queda en 0 (el pedido la escribe en el orden del combo).
    expect(line.components.map((c) => c.position)).toEqual([0])
    await db.order.delete({ where: { id: order.id } })
  })

  it('los CHECK de combos rechazan precio y posiciones fuera de rango', async () => {
    const db = prisma()
    const { mate: product } = await comboCatalog('combo-checks')
    const combo = { name: 'Combo', description: 'D', priceArs: 61999, position: 1 }

    for (const priceArs of [0, 100_000_000]) {
      await expect(db.combo.create({ data: { ...combo, priceArs } })).rejects.toThrow(
        /combos_price_ars_check/,
      )
    }
    await expect(db.combo.create({ data: { ...combo, position: 0 } })).rejects.toThrow(
      /combos_position_check/,
    )

    const saved = await db.combo.create({ data: { ...combo, priceArs: 99_999_999 } })
    expect(saved.status).toBe('draft')
    for (const position of [0, 4]) {
      await expect(
        db.comboItem.create({ data: { comboId: saved.id, position, productId: product.id } }),
      ).rejects.toThrow(/combo_items_position_check/)
    }
    await db.comboItem.create({ data: { comboId: saved.id, position: 1, productId: product.id } })
    // El mismo producto dos veces en un combo choca con el único (combo_id, product_id).
    await expect(
      db.comboItem.create({ data: { comboId: saved.id, position: 2, productId: product.id } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await db.combo.delete({ where: { id: saved.id } })
  })

  it('un producto que está en un combo no se borra; borrar el combo borra sus piezas', async () => {
    const db = prisma()
    const { category, mate } = await comboCatalog('combo-borrado')
    const yerba = await db.product.create({
      data: { slug: 'yerba-combo', categoryId: category.id, name: 'Yerba combo', description: 'D' },
    })
    const combo = await db.combo.create({
      data: {
        name: 'Mate y yerba',
        description: 'D',
        priceArs: 45000,
        status: 'published',
        position: 1,
        items: {
          create: [
            { position: 1, productId: yerba.id },
            { position: 2, productId: mate.id },
          ],
        },
      },
    })

    await expect(db.product.delete({ where: { id: yerba.id } })).rejects.toMatchObject({
      code: 'P2003',
    })

    await db.combo.delete({ where: { id: combo.id } })
    expect(await db.comboItem.count({ where: { comboId: combo.id } })).toBe(0)
    await db.product.delete({ where: { id: yerba.id } })
  })
})
