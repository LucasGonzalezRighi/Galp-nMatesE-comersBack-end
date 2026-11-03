import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { SECRETS_PORT, type SecretsPort } from '../../shared/application/ports/secrets.port'
import { type Clock, CLOCK } from '../../shared/domain/clock'
import { IdentityModule } from '../identity/identity.module'
import { SettingsModule } from '../settings/settings.module'
import { CreateOrderCommand } from './application/commands/create-order.command'
import { ExpireOrdersCommand } from './application/commands/expire-orders.command'
import {
  CUSTOMER_DIRECTORY_PORT,
  type CustomerDirectoryPort,
} from './application/ports/customer-directory.port'
import {
  ORDER_EXPIRATION_SCHEDULER,
  type OrderExpirationSchedulerPort,
} from './application/ports/order-expiration.port'
import { ORDER_REPOSITORY, type OrderRepository } from './application/ports/order.repository.port'
import {
  PRODUCT_CATALOG_PORT,
  type ProductCatalogPort,
} from './application/ports/product-catalog.port'
import {
  STORE_SETTINGS_PORT,
  type StoreSettingsPort,
} from './application/ports/store-settings.port'
import { GetMyOrderQuery } from './application/queries/get-my-order.query'
import { GetOrderQuery } from './application/queries/get-order.query'
import { ListMyOrdersQuery } from './application/queries/list-my-orders.query'
import { QuoteCartQuery } from './application/queries/quote-cart.query'
import { QuoteShippingQuery } from './application/queries/quote-shipping.query'
import { BullOrderExpirationScheduler } from './infrastructure/bull-order-expiration.scheduler'
import { CatalogProductsAdapter } from './infrastructure/catalog-products.adapter'
import { IdentityCustomersAdapter } from './infrastructure/identity-customers.adapter'
import { ORDER_EXPIRATION_QUEUE } from './infrastructure/order-expiration.queue'
import { OrderExpirationProcessor } from './infrastructure/order-expiration.processor'
import { OrderExpirationSweep } from './infrastructure/order-expiration.sweep'
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository'
import { SettingsStoreAdapter } from './infrastructure/settings-store.adapter'

/**
 * Pedidos y stock: cotización del carrito y del envío, creación con el stock reservado 30
 * minutos, lectura por token o por sesión y vencimiento de las reservas.
 *
 * Los pedidos van con Prisma (la reserva es un `UPDATE` condicional en la misma transacción que
 * el pedido y sus eventos del outbox); los productos se leen directo de `products` + `inventory`;
 * los ajustes, de `SettingsModule`; los clientes, del `CUSTOMER_REPOSITORY` de `IdentityModule`.
 * El vencimiento tiene tres caminos idempotentes: el job diferido de la cola `order-expiration`
 * (con `enableOfflineQueue: false`, como el outbox: con Redis caído falla al instante y el cierre
 * de la app no lo espera), el barrido cada 60 s y la lectura. El reloj y los secretos vienen de
 * los módulos globales.
 *
 * Los casos de uso no conocen Nest: se cablean acá con `useFactory`. Exporta
 * {@link GetOrderQuery} (lo usa B5).
 */
@Module({
  imports: [
    IdentityModule,
    SettingsModule,
    BullModule.registerQueueAsync({
      name: ORDER_EXPIRATION_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL, enableOfflineQueue: false },
      }),
    }),
  ],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: PRODUCT_CATALOG_PORT, useClass: CatalogProductsAdapter },
    { provide: STORE_SETTINGS_PORT, useClass: SettingsStoreAdapter },
    { provide: CUSTOMER_DIRECTORY_PORT, useClass: IdentityCustomersAdapter },
    { provide: ORDER_EXPIRATION_SCHEDULER, useClass: BullOrderExpirationScheduler },
    {
      provide: ExpireOrdersCommand,
      useFactory: (orders: OrderRepository, clock: Clock) => new ExpireOrdersCommand(orders, clock),
      inject: [ORDER_REPOSITORY, CLOCK],
    },
    {
      provide: CreateOrderCommand,
      useFactory: (
        catalog: ProductCatalogPort,
        settings: StoreSettingsPort,
        orders: OrderRepository,
        customers: CustomerDirectoryPort,
        secrets: SecretsPort,
        clock: Clock,
        scheduler: OrderExpirationSchedulerPort,
        expire: ExpireOrdersCommand,
      ) =>
        new CreateOrderCommand(
          catalog,
          settings,
          orders,
          customers,
          secrets,
          clock,
          scheduler,
          expire,
        ),
      inject: [
        PRODUCT_CATALOG_PORT,
        STORE_SETTINGS_PORT,
        ORDER_REPOSITORY,
        CUSTOMER_DIRECTORY_PORT,
        SECRETS_PORT,
        CLOCK,
        ORDER_EXPIRATION_SCHEDULER,
        ExpireOrdersCommand,
      ],
    },
    {
      provide: QuoteCartQuery,
      useFactory: (
        catalog: ProductCatalogPort,
        settings: StoreSettingsPort,
        expire: ExpireOrdersCommand,
      ) => new QuoteCartQuery(catalog, settings, expire),
      inject: [PRODUCT_CATALOG_PORT, STORE_SETTINGS_PORT, ExpireOrdersCommand],
    },
    {
      provide: QuoteShippingQuery,
      useFactory: (settings: StoreSettingsPort) => new QuoteShippingQuery(settings),
      inject: [STORE_SETTINGS_PORT],
    },
    {
      provide: GetOrderQuery,
      useFactory: (orders: OrderRepository, secrets: SecretsPort, expire: ExpireOrdersCommand) =>
        new GetOrderQuery(orders, secrets, expire),
      inject: [ORDER_REPOSITORY, SECRETS_PORT, ExpireOrdersCommand],
    },
    {
      provide: ListMyOrdersQuery,
      useFactory: (orders: OrderRepository, expire: ExpireOrdersCommand) =>
        new ListMyOrdersQuery(orders, expire),
      inject: [ORDER_REPOSITORY, ExpireOrdersCommand],
    },
    {
      provide: GetMyOrderQuery,
      useFactory: (orders: OrderRepository, expire: ExpireOrdersCommand) =>
        new GetMyOrderQuery(orders, expire),
      inject: [ORDER_REPOSITORY, ExpireOrdersCommand],
    },
    OrderExpirationProcessor,
    OrderExpirationSweep,
  ],
  exports: [GetOrderQuery],
})
export class OrdersModule {}
