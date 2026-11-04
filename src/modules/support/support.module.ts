import { Logger, Module } from '@nestjs/common'

import { CLOCK, type Clock } from '../../shared/domain/clock'
import { MarkMessageCommand } from './application/commands/mark-message.command'
import { RequestWithdrawalCommand } from './application/commands/request-withdrawal.command'
import { SendContactMessageCommand } from './application/commands/send-contact-message.command'
import {
  CONTACT_MESSAGE_REPOSITORY,
  type ContactMessageRepository,
} from './application/ports/contact-message.repository.port'
import { ListAdminMessagesQuery } from './application/queries/list-admin-messages.query'
import { PrismaContactMessageRepository } from './infrastructure/prisma-contact-message.repository'
import { AdminMessagesController } from './interface/admin-messages.controller'
import { ContactController } from './interface/contact.controller'

/**
 * Bandeja del dashboard (Ruling B-76): el formulario de contacto (`POST /contact`), el botón de
 * arrepentimiento (`POST /withdrawals`, con su código `ARR-` + 6 dígitos) y la bandeja del admin
 * (`GET /admin/messages` y `PATCH /admin/messages/{id}`). Los mails llegan en B7: por ahora los
 * casos de uso dejan la intención en el log (un `Logger` de Nest), sin datos personales.
 */
@Module({
  controllers: [ContactController, AdminMessagesController],
  providers: [
    { provide: CONTACT_MESSAGE_REPOSITORY, useClass: PrismaContactMessageRepository },
    {
      provide: SendContactMessageCommand,
      useFactory: (messages: ContactMessageRepository) =>
        new SendContactMessageCommand(messages, new Logger(SendContactMessageCommand.name)),
      inject: [CONTACT_MESSAGE_REPOSITORY],
    },
    {
      provide: RequestWithdrawalCommand,
      useFactory: (messages: ContactMessageRepository) =>
        new RequestWithdrawalCommand(messages, new Logger(RequestWithdrawalCommand.name)),
      inject: [CONTACT_MESSAGE_REPOSITORY],
    },
    {
      provide: ListAdminMessagesQuery,
      useFactory: (messages: ContactMessageRepository) => new ListAdminMessagesQuery(messages),
      inject: [CONTACT_MESSAGE_REPOSITORY],
    },
    {
      provide: MarkMessageCommand,
      useFactory: (messages: ContactMessageRepository, clock: Clock) =>
        new MarkMessageCommand(messages, clock),
      inject: [CONTACT_MESSAGE_REPOSITORY, CLOCK],
    },
  ],
})
export class SupportModule {}
