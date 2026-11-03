import { BullModule } from '@nestjs/bullmq'
import { Logger, Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { SECRETS_PORT, type SecretsPort } from '../../shared/application/ports/secrets.port'
import { type Clock, CLOCK } from '../../shared/domain/clock'
import { ExpireOrdersCommand } from '../orders/application/commands/expire-orders.command'
import {
  ORDER_PAYMENTS_PORT,
  type OrderPaymentsPort,
} from '../orders/application/ports/order-payments.port'
import { OrdersModule } from '../orders/orders.module'
import { SettingsModule } from '../settings/settings.module'
import { ApplyProviderPaymentCommand } from './application/commands/apply-provider-payment.command'
import { CancelPaymentCommand } from './application/commands/cancel-payment.command'
import { CreatePreferenceCommand } from './application/commands/create-preference.command'
import { OnOrderExpiredCommand } from './application/commands/on-order-expired.command'
import { PayWithCardCommand } from './application/commands/pay-with-card.command'
import { ProcessWebhookEventCommand } from './application/commands/process-webhook-event.command'
import { ReceiveWebhookCommand } from './application/commands/receive-webhook.command'
import { ReconcilePendingPaymentsCommand } from './application/commands/reconcile-pending-payments.command'
import { ReprocessWebhookEventsCommand } from './application/commands/reprocess-webhook-events.command'
import { SimulateProviderResultCommand } from './application/commands/simulate-provider-result.command'
import { PaymentOrderAccess } from './application/order-access'
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './application/ports/payment-gateway.port'
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from './application/ports/payment.repository.port'
import {
  PAYMENTS_SETTINGS,
  type PaymentsSettings,
} from './application/ports/payments-settings.port'
import {
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepository,
} from './application/ports/webhook-event.repository.port'
import { WEBHOOK_QUEUE_PORT, type WebhookQueuePort } from './application/ports/webhook-queue.port'
import { GetInstallmentsQuery } from './application/queries/get-installments.query'
import { BullWebhookQueue } from './infrastructure/bull-webhook-queue.adapter'
import { EnvPaymentsSettings } from './infrastructure/env-payments-settings.adapter'
import { hmacSha256Hex } from './infrastructure/hmac'
import { MercadoPagoGateway } from './infrastructure/mercadopago.gateway'
import { OrderExpiredOutboxHandler } from './infrastructure/order-expired.outbox-handler'
import { PAYMENT_WEBHOOKS_QUEUE } from './infrastructure/payment-webhooks.queue'
import { PaymentWebhooksProcessor } from './infrastructure/payment-webhooks.processor'
import { PaymentsSweep } from './infrastructure/payments-sweep'
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository'
import { PrismaWebhookEventRepository } from './infrastructure/prisma-webhook-event.repository'
import { SimulatedGateway } from './infrastructure/simulated.gateway'
import { PaymentsController } from './interface/payments.controller'
import { SimulatedMercadoPagoController } from './interface/simulated-mercadopago.controller'
import { WebhooksController } from './interface/webhooks.controller'

/** Cola con `enableOfflineQueue: false`: con Redis caído falla al instante y no cuelga el cierre. */
function queueConnection(env: Env) {
  return { connection: { url: env.REDIS_URL, enableOfflineQueue: false } }
}

/**
 * Pasarela según `MP_MODE` (Ruling B-47): `live` → {@link MercadoPagoGateway} con el SDK;
 * `simulated` → {@link SimulatedGateway} con las páginas del back.
 *
 * @throws {Error} En español, si `live` no tiene `MP_ACCESS_TOKEN` (el esquema ya lo impide).
 */
function createGateway(env: Env, settings: EnvPaymentsSettings, clock: Clock): PaymentGatewayPort {
  if (env.MP_MODE === 'simulated') {
    return new SimulatedGateway(settings, settings.simulatorOrigin, clock)
  }
  if (env.MP_ACCESS_TOKEN === undefined) {
    throw new Error('Con MP_MODE=live hace falta MP_ACCESS_TOKEN')
  }
  return new MercadoPagoGateway({
    accessToken: env.MP_ACCESS_TOKEN,
    clock,
    logger: new Logger(MercadoPagoGateway.name),
  })
}

/**
 * Pagos con Mercado Pago (B5): preferencia de Checkout Pro, tarjeta con 3-D Secure y cuotas,
 * cancelación del intento, webhook firmado con su cola `payment-webhooks`, conciliación y
 * devoluciones automáticas.
 *
 * Los intentos, devoluciones y notificaciones van con Prisma; las escrituras sobre pedidos pasan
 * por el `ORDER_PAYMENTS_PORT` de {@link OrdersModule} (salvo `orders.payment_status`, que
 * `PrismaPaymentRepository` escribe con su `tx`: Ruling B-45). La pasarela se elige por `MP_MODE`
 * y los E2E la reemplazan con `createApp({ gateway })`. Las colas usan
 * `enableOfflineQueue: false` y sus workers se cierran forzados si Redis no contesta (el contrato
 * arma la app sin `init()` contra un Redis que no existe). `OrderExpiredOutboxHandler` atiende
 * `order.expired` del outbox compartido (Ruling B-43): cancela el intento activo y devuelve lo
 * cobrado de un pedido que venció sin completarse. El barrido de 60 s vence, concilia y retoma
 * notificaciones.
 *
 * Los casos de uso no conocen Nest: se cablean acá con `useFactory`, con un `Logger` de Nest como
 * `PaymentsLogger` y el HMAC de `node:crypto` como función. Las rutas: las cuatro de pago del
 * pedido, el webhook y el simulador (que solo existe en `MP_MODE=simulated` fuera de producción).
 */
@Module({
  controllers: [PaymentsController, WebhooksController, SimulatedMercadoPagoController],
  imports: [
    OrdersModule,
    SettingsModule,
    BullModule.registerQueueAsync({
      name: PAYMENT_WEBHOOKS_QUEUE,
      inject: [ENV],
      useFactory: queueConnection,
    }),
  ],
  providers: [
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    PrismaWebhookEventRepository,
    { provide: WEBHOOK_EVENT_REPOSITORY, useExisting: PrismaWebhookEventRepository },
    EnvPaymentsSettings,
    { provide: PAYMENTS_SETTINGS, useExisting: EnvPaymentsSettings },
    { provide: WEBHOOK_QUEUE_PORT, useClass: BullWebhookQueue },
    {
      provide: PAYMENT_GATEWAY_PORT,
      useFactory: createGateway,
      inject: [ENV, EnvPaymentsSettings, CLOCK],
    },
    {
      provide: PaymentOrderAccess,
      useFactory: (
        orders: OrderPaymentsPort,
        secrets: SecretsPort,
        expire: ExpireOrdersCommand,
        clock: Clock,
      ) => new PaymentOrderAccess(orders, secrets, expire, clock),
      inject: [ORDER_PAYMENTS_PORT, SECRETS_PORT, ExpireOrdersCommand, CLOCK],
    },
    {
      provide: ApplyProviderPaymentCommand,
      useFactory: (
        payments: PaymentRepository,
        orders: OrderPaymentsPort,
        gateway: PaymentGatewayPort,
        clock: Clock,
      ) =>
        new ApplyProviderPaymentCommand(
          payments,
          orders,
          gateway,
          clock,
          new Logger(ApplyProviderPaymentCommand.name),
        ),
      inject: [PAYMENT_REPOSITORY, ORDER_PAYMENTS_PORT, PAYMENT_GATEWAY_PORT, CLOCK],
    },
    {
      provide: CreatePreferenceCommand,
      useFactory: (
        access: PaymentOrderAccess,
        payments: PaymentRepository,
        gateway: PaymentGatewayPort,
        settings: PaymentsSettings,
        clock: Clock,
      ) =>
        new CreatePreferenceCommand(
          access,
          payments,
          gateway,
          settings,
          clock,
          new Logger(CreatePreferenceCommand.name),
        ),
      inject: [
        PaymentOrderAccess,
        PAYMENT_REPOSITORY,
        PAYMENT_GATEWAY_PORT,
        PAYMENTS_SETTINGS,
        CLOCK,
      ],
    },
    {
      provide: PayWithCardCommand,
      useFactory: (
        access: PaymentOrderAccess,
        payments: PaymentRepository,
        gateway: PaymentGatewayPort,
        apply: ApplyProviderPaymentCommand,
        settings: PaymentsSettings,
        clock: Clock,
      ) =>
        new PayWithCardCommand(
          access,
          payments,
          gateway,
          apply,
          settings,
          clock,
          new Logger(PayWithCardCommand.name),
        ),
      inject: [
        PaymentOrderAccess,
        PAYMENT_REPOSITORY,
        PAYMENT_GATEWAY_PORT,
        ApplyProviderPaymentCommand,
        PAYMENTS_SETTINGS,
        CLOCK,
      ],
    },
    {
      provide: CancelPaymentCommand,
      useFactory: (
        access: PaymentOrderAccess,
        payments: PaymentRepository,
        gateway: PaymentGatewayPort,
      ) =>
        new CancelPaymentCommand(access, payments, gateway, new Logger(CancelPaymentCommand.name)),
      inject: [PaymentOrderAccess, PAYMENT_REPOSITORY, PAYMENT_GATEWAY_PORT],
    },
    {
      provide: GetInstallmentsQuery,
      useFactory: (
        access: PaymentOrderAccess,
        gateway: PaymentGatewayPort,
        settings: PaymentsSettings,
      ) => new GetInstallmentsQuery(access, gateway, settings),
      inject: [PaymentOrderAccess, PAYMENT_GATEWAY_PORT, PAYMENTS_SETTINGS],
    },
    {
      provide: ProcessWebhookEventCommand,
      useFactory: (
        events: WebhookEventRepository,
        gateway: PaymentGatewayPort,
        apply: ApplyProviderPaymentCommand,
        clock: Clock,
      ) => new ProcessWebhookEventCommand(events, gateway, apply, clock),
      inject: [WEBHOOK_EVENT_REPOSITORY, PAYMENT_GATEWAY_PORT, ApplyProviderPaymentCommand, CLOCK],
    },
    {
      provide: ReceiveWebhookCommand,
      useFactory: (
        settings: PaymentsSettings,
        events: WebhookEventRepository,
        queue: WebhookQueuePort,
        process: ProcessWebhookEventCommand,
        clock: Clock,
      ) => new ReceiveWebhookCommand(settings, hmacSha256Hex, events, queue, process, clock),
      inject: [
        PAYMENTS_SETTINGS,
        WEBHOOK_EVENT_REPOSITORY,
        WEBHOOK_QUEUE_PORT,
        ProcessWebhookEventCommand,
        CLOCK,
      ],
    },
    {
      provide: ReconcilePendingPaymentsCommand,
      useFactory: (
        orders: OrderPaymentsPort,
        payments: PaymentRepository,
        gateway: PaymentGatewayPort,
        apply: ApplyProviderPaymentCommand,
        expire: ExpireOrdersCommand,
        clock: Clock,
      ) =>
        new ReconcilePendingPaymentsCommand(
          orders,
          payments,
          gateway,
          apply,
          expire,
          clock,
          new Logger(ReconcilePendingPaymentsCommand.name),
        ),
      inject: [
        ORDER_PAYMENTS_PORT,
        PAYMENT_REPOSITORY,
        PAYMENT_GATEWAY_PORT,
        ApplyProviderPaymentCommand,
        ExpireOrdersCommand,
        CLOCK,
      ],
    },
    {
      provide: ReprocessWebhookEventsCommand,
      useFactory: (
        events: WebhookEventRepository,
        process: ProcessWebhookEventCommand,
        clock: Clock,
      ) =>
        new ReprocessWebhookEventsCommand(
          events,
          process,
          clock,
          new Logger(ReprocessWebhookEventsCommand.name),
        ),
      inject: [WEBHOOK_EVENT_REPOSITORY, ProcessWebhookEventCommand, CLOCK],
    },
    {
      provide: OnOrderExpiredCommand,
      useFactory: (
        payments: PaymentRepository,
        gateway: PaymentGatewayPort,
        apply: ApplyProviderPaymentCommand,
      ) =>
        new OnOrderExpiredCommand(payments, gateway, apply, new Logger(OnOrderExpiredCommand.name)),
      inject: [PAYMENT_REPOSITORY, PAYMENT_GATEWAY_PORT, ApplyProviderPaymentCommand],
    },
    {
      provide: SimulateProviderResultCommand,
      useFactory: (
        payments: PaymentRepository,
        orders: OrderPaymentsPort,
        apply: ApplyProviderPaymentCommand,
        clock: Clock,
        gateway: PaymentGatewayPort,
      ) =>
        new SimulateProviderResultCommand(payments, orders, apply, clock, (payment) => {
          // Así `getPayment` del simulador devuelve lo que se resolvió (con otra pasarela, nada).
          if (gateway instanceof SimulatedGateway) gateway.remember(payment)
        }),
      inject: [
        PAYMENT_REPOSITORY,
        ORDER_PAYMENTS_PORT,
        ApplyProviderPaymentCommand,
        CLOCK,
        PAYMENT_GATEWAY_PORT,
      ],
    },
    PaymentWebhooksProcessor,
    OrderExpiredOutboxHandler,
    PaymentsSweep,
  ],
})
export class PaymentsModule {}
