import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { NotificationsModule } from '../notifications/notifications.module'
import { QueuedPasswordResetMailer } from '../notifications/infrastructure/queued-password-reset.mailer'
import { SECRETS_PORT, type SecretsPort } from '../../shared/application/ports/secrets.port'
import { SESSION_PORT, type SessionPort } from '../../shared/application/ports/session.port'
import { type Clock, CLOCK } from '../../shared/domain/clock'
import { RedisService } from '../../shared/infrastructure/redis/redis.service'
import { AdminLoginCommand } from './application/commands/admin-login.command'
import { ChangeAdminPasswordCommand } from './application/commands/change-admin-password.command'
import { CreateMyAddressCommand } from './application/commands/create-my-address.command'
import { DeleteMyAddressCommand } from './application/commands/delete-my-address.command'
import { IssueCsrfTokenCommand } from './application/commands/issue-csrf-token.command'
import { LoginCustomerCommand } from './application/commands/login-customer.command'
import { LogoutCommand } from './application/commands/logout.command'
import { RegisterCustomerCommand } from './application/commands/register-customer.command'
import { RequestPasswordResetCommand } from './application/commands/request-password-reset.command'
import { ResetPasswordCommand } from './application/commands/reset-password.command'
import { UpdateMeCommand } from './application/commands/update-me.command'
import { UpdateMyAddressCommand } from './application/commands/update-my-address.command'
import {
  ADDRESS_REPOSITORY,
  type AddressRepository,
} from './application/ports/address.repository.port'
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from './application/ports/customer.repository.port'
import {
  LOGIN_ATTEMPTS_PORT,
  type LoginAttemptsPort,
} from './application/ports/login-attempts.port'
import { MAILER_PORT, type MailerPort } from './application/ports/mailer.port'
import { PASSWORD_HASHER, type PasswordHasher } from './application/ports/password-hasher.port'
import {
  PASSWORD_RESET_REPOSITORY,
  type PasswordResetRepository,
} from './application/ports/password-reset.repository.port'
import { USER_REPOSITORY, type UserRepository } from './application/ports/user.repository.port'
import { GetAdminSessionQuery } from './application/queries/get-admin-session.query'
import { GetMeQuery } from './application/queries/get-me.query'
import { ListMyAddressesQuery } from './application/queries/list-my-addresses.query'
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher'
import { PrismaAddressRepository } from './infrastructure/prisma-address.repository'
import { PrismaCustomerRepository } from './infrastructure/prisma-customer.repository'
import { PrismaPasswordResetRepository } from './infrastructure/prisma-password-reset.repository'
import { PrismaUserRepository } from './infrastructure/prisma-user.repository'
import { RedisLoginAttempts } from './infrastructure/redis-login-attempts.adapter'
import { AdminAuthController } from './interface/admin-auth.controller'
import { AuthController } from './interface/auth.controller'
import { MeController } from './interface/me.controller'

/**
 * Identidad: cuentas de clientes y admins, sesiones, recuperación de contraseña y libreta de
 * direcciones. Los repositorios son de Prisma, las contraseñas van con argon2id, los fallos de
 * inicio de sesión se cuentan en Redis (falla abierta) y el mail de recuperación sale por la cola
 * `mails` de `NotificationsModule` (B7). Las sesiones y los secretos vienen de `RedisModule`
 * (global) y el reloj de `SharedModule`.
 *
 * Los casos de uso no conocen Nest: se cablean acá con `useFactory`. Las rutas son las de
 * `/auth`, `/me` y `/admin/auth` del contrato. Exporta {@link GetMeQuery} y `CUSTOMER_REPOSITORY`
 * (los usa `orders` en B4 para el dueño del pedido).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [AuthController, MeController, AdminAuthController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
    { provide: ADDRESS_REPOSITORY, useClass: PrismaAddressRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: PrismaPasswordResetRepository },
    { provide: PASSWORD_HASHER, useValue: new Argon2PasswordHasher() },
    { provide: MAILER_PORT, useExisting: QueuedPasswordResetMailer },
    {
      provide: LOGIN_ATTEMPTS_PORT,
      useFactory: (redis: RedisService) => new RedisLoginAttempts(redis.client),
      inject: [RedisService],
    },
    {
      provide: IssueCsrfTokenCommand,
      useFactory: (sessions: SessionPort) => new IssueCsrfTokenCommand(sessions),
      inject: [SESSION_PORT],
    },
    {
      provide: RegisterCustomerCommand,
      useFactory: (
        users: UserRepository,
        customers: CustomerRepository,
        hasher: PasswordHasher,
        sessions: SessionPort,
      ) => new RegisterCustomerCommand(users, customers, hasher, sessions),
      inject: [USER_REPOSITORY, CUSTOMER_REPOSITORY, PASSWORD_HASHER, SESSION_PORT],
    },
    {
      provide: LoginCustomerCommand,
      useFactory: (
        users: UserRepository,
        customers: CustomerRepository,
        hasher: PasswordHasher,
        attempts: LoginAttemptsPort,
        sessions: SessionPort,
        clock: Clock,
      ) => new LoginCustomerCommand(users, customers, hasher, attempts, sessions, clock),
      inject: [
        USER_REPOSITORY,
        CUSTOMER_REPOSITORY,
        PASSWORD_HASHER,
        LOGIN_ATTEMPTS_PORT,
        SESSION_PORT,
        CLOCK,
      ],
    },
    {
      provide: LogoutCommand,
      useFactory: (sessions: SessionPort) => new LogoutCommand(sessions),
      inject: [SESSION_PORT],
    },
    {
      provide: RequestPasswordResetCommand,
      useFactory: (
        users: UserRepository,
        customers: CustomerRepository,
        resets: PasswordResetRepository,
        mailer: MailerPort,
        secrets: SecretsPort,
        clock: Clock,
        env: Env,
      ) =>
        new RequestPasswordResetCommand(
          users,
          customers,
          resets,
          mailer,
          secrets,
          clock,
          env.STORE_ORIGIN,
        ),
      inject: [
        USER_REPOSITORY,
        CUSTOMER_REPOSITORY,
        PASSWORD_RESET_REPOSITORY,
        MAILER_PORT,
        SECRETS_PORT,
        CLOCK,
        ENV,
      ],
    },
    {
      provide: ResetPasswordCommand,
      useFactory: (
        resets: PasswordResetRepository,
        users: UserRepository,
        hasher: PasswordHasher,
        sessions: SessionPort,
        secrets: SecretsPort,
        clock: Clock,
      ) => new ResetPasswordCommand(resets, users, hasher, sessions, secrets, clock),
      inject: [
        PASSWORD_RESET_REPOSITORY,
        USER_REPOSITORY,
        PASSWORD_HASHER,
        SESSION_PORT,
        SECRETS_PORT,
        CLOCK,
      ],
    },
    {
      provide: GetMeQuery,
      useFactory: (customers: CustomerRepository) => new GetMeQuery(customers),
      inject: [CUSTOMER_REPOSITORY],
    },
    {
      provide: UpdateMeCommand,
      useFactory: (customers: CustomerRepository) => new UpdateMeCommand(customers),
      inject: [CUSTOMER_REPOSITORY],
    },
    {
      provide: ListMyAddressesQuery,
      useFactory: (addresses: AddressRepository) => new ListMyAddressesQuery(addresses),
      inject: [ADDRESS_REPOSITORY],
    },
    {
      provide: CreateMyAddressCommand,
      useFactory: (addresses: AddressRepository) => new CreateMyAddressCommand(addresses),
      inject: [ADDRESS_REPOSITORY],
    },
    {
      provide: UpdateMyAddressCommand,
      useFactory: (addresses: AddressRepository) => new UpdateMyAddressCommand(addresses),
      inject: [ADDRESS_REPOSITORY],
    },
    {
      provide: DeleteMyAddressCommand,
      useFactory: (addresses: AddressRepository) => new DeleteMyAddressCommand(addresses),
      inject: [ADDRESS_REPOSITORY],
    },
    {
      provide: AdminLoginCommand,
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        attempts: LoginAttemptsPort,
        sessions: SessionPort,
        clock: Clock,
      ) => new AdminLoginCommand(users, hasher, attempts, sessions, clock),
      inject: [USER_REPOSITORY, PASSWORD_HASHER, LOGIN_ATTEMPTS_PORT, SESSION_PORT, CLOCK],
    },
    {
      provide: GetAdminSessionQuery,
      useFactory: (users: UserRepository) => new GetAdminSessionQuery(users),
      inject: [USER_REPOSITORY],
    },
    {
      provide: ChangeAdminPasswordCommand,
      useFactory: (users: UserRepository, hasher: PasswordHasher, sessions: SessionPort) =>
        new ChangeAdminPasswordCommand(users, hasher, sessions),
      inject: [USER_REPOSITORY, PASSWORD_HASHER, SESSION_PORT],
    },
  ],
  exports: [GetMeQuery, CUSTOMER_REPOSITORY],
})
export class IdentityModule {}
