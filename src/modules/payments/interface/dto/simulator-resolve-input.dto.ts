import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { SIMULATOR_RESULTS, type SimulatorResult } from '../../domain/simulated-cards'

/** Largo máximo de los ids que manda la página del simulador. */
const SIMULATOR_ID_MAX_LENGTH = 100

/** Textos de error del `resolve` del simulador. */
export const SIMULATOR_RESOLVE_MESSAGES = {
  /** Falta la preferencia y el pago (o no son texto). */
  target: 'Falta la preferencia o el pago.',
  /** Resultado que no es uno de los botones del simulador. */
  result: 'Elegí un resultado del simulador.',
} as const

/**
 * Lo que postean las páginas del simulador (formulario o JSON): la preferencia (checkout) o el
 * pago (desafío 3-D Secure) y el botón elegido. Fuera del contrato y de Swagger.
 */
export class SimulatorResolveInputDto {
  /** Id de la preferencia (página de checkout). */
  @IsOptional()
  @MaxLength(SIMULATOR_ID_MAX_LENGTH, { message: SIMULATOR_RESOLVE_MESSAGES.target })
  @IsString({ message: SIMULATOR_RESOLVE_MESSAGES.target })
  preference?: string

  /** Id del pago en la pasarela (página del desafío). */
  @IsOptional()
  @MaxLength(SIMULATOR_ID_MAX_LENGTH, { message: SIMULATOR_RESOLVE_MESSAGES.target })
  @IsString({ message: SIMULATOR_RESOLVE_MESSAGES.target })
  payment?: string

  /** Botón elegido. */
  @IsIn(SIMULATOR_RESULTS, { message: SIMULATOR_RESOLVE_MESSAGES.result })
  result!: SimulatorResult
}
