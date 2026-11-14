import type { SessionPort, SessionRecord } from '../../../../shared/application/ports/session.port'
import { newId } from '../../../../shared/domain/id'
import { normalizePersonName } from '../../domain/customer.entity'
import { normalizeEmail } from '../../domain/email'
import { EmailAlreadyRegisteredError } from '../../domain/identity-errors'
import { rotateSession } from '../authentication'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { NewUser, UserRepository } from '../ports/user.repository.port'
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
 * Crea una cuenta de cliente con un cliente nuevo. Nunca adopta al invitado que compró con ese
 * email (NV-02): escribir un email no prueba que sea de quien se registra, así que los pedidos y
 * los datos del invitado quedan con el invitado (se leen por token, como siempre) y la cuenta nueva
 * no los ve. Abre una sesión de cliente y cierra la actual. El alta del usuario y la del cliente
 * son una sola operación atómica del repositorio de clientes.
 */
export class RegisterCustomerCommand {
  /**
   * @param users - Usuarios (solo para consultar si el email ya está registrado).
   * @param customers - Clientes (crea usuario y cliente juntos, sin tocar al invitado).
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

    const user: NewUser = {
      id: newId(),
      email,
      passwordHash: await this.hasher.hash(input.password),
      role: 'customer',
      status: 'active',
    }
    // Usuario y cliente se crean en una sola operación atómica del repositorio de clientes: si
    // falla, no queda un usuario sin cliente que bloquee la cuenta.
    const customer = await this.customers.createWithUser(user, {
      id: newId(),
      email,
      firstName,
      lastName,
      phone: null,
    })

    const session = await rotateSession(this.sessions, currentSessionId, {
      kind: 'customer',
      userId: user.id,
      customerId: customer.id,
    })
    return { customer: toCustomerView(customer), session }
  }
}
