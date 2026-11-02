/** Reloj de la app: se inyecta para que los tests controlen la hora (token {@link CLOCK}). */
export interface Clock {
  /** @returns La fecha y hora actuales. */
  now(): Date
}

/** Token de inyección del reloj: `@Inject(CLOCK) private readonly clock: Clock`. */
export const CLOCK = Symbol('CLOCK')

/** Reloj real, basado en la hora del sistema. */
export class SystemClock implements Clock {
  /** @returns `new Date()`. */
  now(): Date {
    return new Date()
  }
}
