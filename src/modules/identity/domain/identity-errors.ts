import { DomainError } from '../../../shared/domain/domain-error'

const INVALID_CREDENTIALS_TITLE = 'Credenciales incorrectas'
const INVALID_CREDENTIALS_DETAIL = 'Email o contraseña incorrectos.'

/** 401 `invalid_credentials`: email o contraseña incorrectos, sin decir cuál de los dos falló. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('invalid_credentials', 401, INVALID_CREDENTIALS_DETAIL, INVALID_CREDENTIALS_TITLE)
    this.name = 'InvalidCredentialsError'
  }
}

/**
 * Cuenta deshabilitada: se responde exactamente igual que {@link InvalidCredentialsError} para no
 * revelar que la cuenta existe.
 */
export class AccountDisabledError extends InvalidCredentialsError {
  constructor() {
    super()
    this.name = 'AccountDisabledError'
  }
}

/** 409 `email_already_registered`: ya hay una cuenta con ese email. */
export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super(
      'email_already_registered',
      409,
      'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.',
      'El email ya tiene una cuenta',
    )
    this.name = 'EmailAlreadyRegisteredError'
  }
}

/** 404 `not_found`: la dirección no existe o es de otro cliente. */
export class AddressNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe esa dirección en tu libreta.')
    this.name = 'AddressNotFoundError'
  }
}

/** 429 `rate_limited`: el email quedó bloqueado por intentos fallidos (con `Retry-After`). */
export class LoginLockedError extends DomainError {
  /**
   * @param retryAfterSeconds - Segundos que faltan para que termine el bloqueo (entero ≥ 1).
   * @throws {RangeError} En español, si no es un entero positivo.
   */
  constructor(retryAfterSeconds: number) {
    super(
      'rate_limited',
      429,
      'Demasiados intentos fallidos. Esperá unos minutos y volvé a intentar.',
      undefined,
      { retryAfterSeconds },
    )
    this.name = 'LoginLockedError'
  }
}

/**
 * 401 `unauthorized`: la sesión es válida pero su usuario o cliente ya no existe (por ejemplo, se
 * borró después de iniciar sesión). Se responde como una sesión faltante.
 */
export class StaleSessionError extends DomainError {
  constructor() {
    super('unauthorized', 401, 'Iniciá sesión para continuar.', 'Sesión requerida')
    this.name = 'StaleSessionError'
  }
}
