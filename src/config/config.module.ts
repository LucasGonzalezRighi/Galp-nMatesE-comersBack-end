import { Global, Module } from '@nestjs/common'

import { ENV, parseEnv, type Env } from './env'

/**
 * Configuración global: valida `process.env` una sola vez al arrancar (si falta una variable, la
 * API no levanta y el error dice cuál) y la expone con el token `ENV` en todos los módulos.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
