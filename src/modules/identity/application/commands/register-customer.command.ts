import type { SessionPort, SessionRecord } from '../../../../shared/application/ports/session.port'
import { newId } from '../../../../shared/domain/id'
import { normalizePersonName } from '../../domain/customer.entity'
import { normalizeEmail } from '../../domain/email'
import { EmailAlreadyRegisteredError } from '../../domain/identity-errors'
import { rotateSession } from '../authentication'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { UserRepository } from '../ports/user.repository.port'
import type { CustomerView } from '../read-models'
import { toCustomerView } from '../views'

/** Datos para crear una cuenta (`RegisterInput` del contrato). */
export interface RegisterCustomerInput {
  /** Email tal como llegó (se normaliza). */
  email: string
  /** Nombre. */
  firstName: string
  /** Apellido. */
  lastName: string
  /** Contraseña nueva, en claro (se guarda solo el hash). */
  password: string
}

/** Cliente con la sesión recién abierta (registro o inicio de sesión). */
export interface CustomerSessionResult {
  /** Datos del cliente. */
  customer: CustomerView
  /** Sesión de cliente nueva: su id va en la cookie. */
  session: SessionRecord
}

/**
 * Crea una cuenta de cliente. Si el email ya compró como invitado, la cuenta se le adjunta a ese
 * cliente (conserva su id, y con él sus pedidos). Abre una sesión de cliente y cierra la actual.
 */
export class RegisterCustomerCommand {
  /**
   * @param users - Usuarios.
   * @param customers - Clientes.
   * @param hasher - Hash de contraseñas.
   * @param sessions - Almacén de sesiones.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionPort,
  ) {}

  /**
   * @param input - Email, nombre, apellido y contraseña.
   * @param currentSessionId - Id de la sesión actual (la anónima del CSRF), o `null`.
   * @returns El cliente y su sesión nueva.
   * @throws {EmailAlreadyRegisteredError} Si ya hay una cuenta con ese email (sin importar
   *   mayúsculas ni espacios).
   * @throws {TypeError} En español, si el email o un nombre quedan vacíos.
   */
  async execute(
    input: RegisterCustomerInput,
    currentSessionId: string | null,
  ): Promise<CustomerSessionResult> {
    const email = normalizeEmail(input.email)
    const firstName = normalizePersonName(input.firstName)
    const lastName = normalizePersonName(input.lastName)
    if ((await this.users.findByEmail(email)) !== null) throw new EmailAlreadyRegisteredError()
    const guest = await this.customers.findByEmail(email)
    if (guest !== null && guest.userId !== null) throw new EmailAlreadyRegisteredError()

    const user = await this.users.create({
      id: newId(),
      email,
      passwordHash: await this.hasher.hash(input.password),
      role: 'customer',
      status: 'active',
    })
    const customer =
      guest === null
        ? await this.customers.create({
            id: newId(),
            userId: user.id,
            email,
            firstName,
            lastName,
            phone: null,
          })
        : await this.customers.attachUser(guest.id, user.id, { firstName, lastName })

    const session = await rotateSession(this.sessions, currentSessionId, {
      kind: 'customer',
      userId: user.id,
      customerId: customer.id,
    })
    return { customer: toCustomerView(customer), session }
  }
}
