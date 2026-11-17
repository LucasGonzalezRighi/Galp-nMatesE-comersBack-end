import { Logger, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { AdminWriteAuditor } from './application/admin-write-auditor'
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from './application/ports/audit-log.repository.port'
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository'
import { AuditInterceptor } from './interface/audit.interceptor'

/**
 * Auditoría del dashboard (B8): un interceptor global deja una fila en `audit_logs` por cada
 * escritura exitosa del admin (quién, qué, sobre qué entidad y qué cambió). No tiene endpoints: la
 * tabla se consulta por SQL. Qué rutas se auditan y cómo está en `domain/admin-write.ts`; los
 * demás módulos no tienen que hacer nada. Los errores de la auditoría van al log (un `Logger` de
 * Nest), sin el cuerpo del pedido.
 */
@Module({
  providers: [
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    {
      provide: AdminWriteAuditor,
      useFactory: (auditLog: AuditLogRepository) =>
        new AdminWriteAuditor(auditLog, new Logger(AdminWriteAuditor.name)),
      inject: [AUDIT_LOG_REPOSITORY],
    },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AuditModule {}
