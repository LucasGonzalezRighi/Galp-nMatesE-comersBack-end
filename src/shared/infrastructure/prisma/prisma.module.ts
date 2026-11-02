import { Global, Module } from '@nestjs/common'

import { PrismaService } from './prisma.service'

/** Módulo global que expone `PrismaService` a los adaptadores de todos los módulos. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
