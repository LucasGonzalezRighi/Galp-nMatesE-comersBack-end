import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'

import { AppModule } from '../../src/app.module'
import { APP_OPTIONS, setupApp } from '../../src/app.setup'
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from '../../src/modules/payments/application/ports/payment-gateway.port'
import { MAIL_PORT, type MailPort } from '../../src/shared/application/ports/mail.port'
import { type Clock, CLOCK } from '../../src/shared/domain/clock'

/** Adaptadores que un E2E puede reemplazar al armar la app. */
export interface AppOverrides {
  /**
   * Envío de mails en lugar del que elige `MAIL_MODE` (por ejemplo, un `RecordingMailPort` de
   * `test/support/mail.ts` para leer los mails, o para simular un SMTP caído).
   */
  mailer?: MailPort
  /** Reloj en lugar del `SystemClock` (por ejemplo, un `FixedClock` para vencer reservas). */
  clock?: Clock
  /**
   * Pasarela de pagos en lugar de la que elige `MP_MODE` (sin `MP_*` es la `SimulatedGateway`):
   * por ejemplo, un `FakeGateway` de `test/support/payments.ts` para programar fallas.
   */
  gateway?: PaymentGatewayPort
}

/**
 * Arma la app como `main.ts` (misma configuración, vía `setupApp`) sin escuchar ningún puerto:
 * los E2E le pegan con supertest a `app.getHttpServer()`.
 *
 * @param overrides - Adaptadores a reemplazar (opcional).
 * @returns La app ya inicializada; quien la crea la cierra con `app.close()`.
 */
export async function createApp(overrides: AppOverrides = {}): Promise<INestApplication<Server>> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
  if (overrides.mailer !== undefined) {
    builder.overrideProvider(MAIL_PORT).useValue(overrides.mailer)
  }
  if (overrides.clock !== undefined) {
    builder.overrideProvider(CLOCK).useValue(overrides.clock)
  }
  if (overrides.gateway !== undefined) {
    builder.overrideProvider(PAYMENT_GATEWAY_PORT).useValue(overrides.gateway)
  }
  const moduleRef = await builder.compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS)
  setupApp(app)
  await app.init()
  return app
}
