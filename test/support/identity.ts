import type {
  AddressRepository,
  NewAddress,
} from '../../src/modules/identity/application/ports/address.repository.port'
import type {
  CustomerPatch,
  CustomerRepository,
  NewCustomer,
} from '../../src/modules/identity/application/ports/customer.repository.port'
import type {
  LoginAttempt,
  LoginAttemptKey,
  LoginAttemptsPort,
} from '../../src/modules/identity/application/ports/login-attempts.port'
import type {
  MailerPort,
  PasswordResetMail,
} from '../../src/modules/identity/application/ports/mailer.port'
import type { PasswordHasher } from '../../src/modules/identity/application/ports/password-hasher.port'
import type {
  NewPasswordResetToken,
  PasswordResetRepository,
} from '../../src/modules/identity/application/ports/password-reset.repository.port'
import type {
  NewUser,
  UserRepository,
} from '../../src/modules/identity/application/ports/user.repository.port'
import {
  type Address,
  type AddressInput,
  MAX_ADDRESSES_PER_CUSTOMER,
} from '../../src/modules/identity/domain/address.entity'
import type { Customer } from '../../src/modules/identity/domain/customer.entity'
import {
  AddressBookFullError,
  EmailAlreadyRegisteredError,
} from '../../src/modules/identity/domain/identity-errors'
import type { User } from '../../src/modules/identity/domain/user.entity'
import type { Clock } from '../../src/shared/domain/clock'

/** Fecha fija con la que arrancan los relojes de prueba. */
export const FIXED_NOW = new Date('2026-11-02T12:00:00.000Z')

/** Reloj de prueba que se queda quieto hasta que el test lo adelanta con {@link FixedClock.advance}. */
export class FixedClock implements Clock {
  private current: number

  /** @param start - Hora inicial (por defecto {@link FIXED_NOW}). */
  constructor(start: Date = FIXED_NOW) {
    this.current = start.getTime()
  }

  /** {@inheritDoc Clock.now} */
  now(): Date {
    return new Date(this.current)
  }

  /**
   * Adelanta el reloj.
   *
   * @param ms - Milisegundos a adelantar.
   */
  advance(ms: number): void {
    this.current += ms
  }
}

/** Compara emails sin importar mayúsculas, como `citext` en la base. */
function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** {@link UserRepository} en memoria; el email es único sin importar mayúsculas (como `citext`). */
export class InMemoryUserRepository implements UserRepository {
  /** Usuarios por id (los tests pueden mirarlos o sembrarlos). */
  readonly users = new Map<string, User>()

  /** {@inheritDoc UserRepository.findByEmail} */
  findByEmail(email: string): Promise<User | null> {
    const user = [...this.users.values()].find((candidate) => sameEmail(candidate.email, email))
    return Promise.resolve(user === undefined ? null : { ...user })
  }

  /** {@inheritDoc UserRepository.findById} */
  findById(id: string): Promise<User | null> {
    const user = this.users.get(id)
    return Promise.resolve(user === undefined ? null : { ...user })
  }

  /** {@inheritDoc UserRepository.create} */
  create(input: NewUser): Promise<User> {
    if ([...this.users.values()].some((candidate) => sameEmail(candidate.email, input.email))) {
      return Promise.reject(new EmailAlreadyRegisteredError())
    }
    const user: User = { ...input, emailVerifiedAt: null, lastLoginAt: null }
    this.users.set(user.id, user)
    return Promise.resolve({ ...user })
  }

  /** {@inheritDoc UserRepository.updatePassword} */
  updatePassword(id: string, passwordHash: string): Promise<void> {
    return this.change(id, { passwordHash })
  }

  /** {@inheritDoc UserRepository.touchLastLogin} */
  touchLastLogin(id: string, at: Date): Promise<void> {
    return this.change(id, { lastLoginAt: new Date(at.getTime()) })
  }

  private change(id: string, patch: Partial<User>): Promise<void> {
    const user = this.users.get(id)
    if (user === undefined) return Promise.reject(new Error(`No existe el usuario ${id}`))
    this.users.set(id, { ...user, ...patch })
    return Promise.resolve()
  }
}

/**
 * {@link CustomerRepository} en memoria, con las reglas de la base: un solo invitado por email (sin
 * importar mayúsculas) y una sola cuenta por email, que pueden convivir. Comparte los usuarios con
 * el {@link InMemoryUserRepository} que recibe, para que `createWithUser` sea atómico como la
 * transacción real: valida todo antes de escribir.
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  /** Clientes por id (los tests pueden mirarlos o sembrarlos). */
  readonly customers = new Map<string, Customer>()

  /** @param userRepository - Usuarios que comparte (donde se crea el usuario de la cuenta). */
  constructor(private readonly userRepository: InMemoryUserRepository) {}

  /** {@inheritDoc CustomerRepository.findByUserId} */
  findByUserId(userId: string): Promise<Customer | null> {
    return this.find((customer) => customer.userId === userId)
  }

  /** {@inheritDoc CustomerRepository.findByEmail} */
  async findByEmail(email: string): Promise<Customer | null> {
    const account = await this.find(
      (customer) => customer.userId !== null && sameEmail(customer.email, email),
    )
    return account ?? this.findGuestByEmail(email)
  }

  /** {@inheritDoc CustomerRepository.findGuestByEmail} */
  findGuestByEmail(email: string): Promise<Customer | null> {
    return this.find((customer) => customer.userId === null && sameEmail(customer.email, email))
  }

  /** {@inheritDoc CustomerRepository.create} */
  create(input: NewCustomer): Promise<Customer> {
    const taken = [...this.customers.values()].some(
      (customer) =>
        (customer.userId === null) === (input.userId === null) &&
        sameEmail(customer.email, input.email),
    )
    if (taken) {
      return Promise.reject(new Error(`Ya hay un cliente con el email ${input.email}`))
    }
    this.customers.set(input.id, { ...input })
    return Promise.resolve({ ...input })
  }

  /** {@inheritDoc CustomerRepository.createWithUser} */
  async createWithUser(user: NewUser, customer: Omit<NewCustomer, 'userId'>): Promise<Customer> {
    const emailTaken =
      (await this.userRepository.findByEmail(user.email)) !== null ||
      [...this.customers.values()].some(
        (candidate) => candidate.userId !== null && sameEmail(candidate.email, customer.email),
      )
    if (emailTaken) throw new EmailAlreadyRegisteredError()
    await this.userRepository.create(user)
    const created: Customer = { ...customer, userId: user.id }
    this.customers.set(created.id, created)
    return { ...created }
  }

  /** {@inheritDoc CustomerRepository.update} */
  update(id: string, patch: CustomerPatch): Promise<Customer> {
    const changes: Partial<Customer> = {}
    if (patch.firstName !== undefined) changes.firstName = patch.firstName
    if (patch.lastName !== undefined) changes.lastName = patch.lastName
    if (patch.phone !== undefined) changes.phone = patch.phone
    return this.change(id, changes)
  }

  private find(predicate: (customer: Customer) => boolean): Promise<Customer | null> {
    const customer = [...this.customers.values()].find(predicate)
    return Promise.resolve(customer === undefined ? null : { ...customer })
  }

  private change(id: string, patch: Partial<Customer>): Promise<Customer> {
    const customer = this.customers.get(id)
    if (customer === undefined) return Promise.reject(new Error(`No existe el cliente ${id}`))
    const changed = { ...customer, ...patch }
    this.customers.set(id, changed)
    return Promise.resolve({ ...changed })
  }
}

/**
 * {@link AddressRepository} en memoria: guarda en orden de alta y, como la base, deja una sola
 * predeterminada por cliente.
 */
export class InMemoryAddressRepository implements AddressRepository {
  /** Direcciones en orden de alta. */
  readonly addresses: Address[] = []

  /** {@inheritDoc AddressRepository.listByCustomer} */
  listByCustomer(customerId: string): Promise<Address[]> {
    const own = this.addresses.filter((address) => address.customerId === customerId)
    // `sort` es estable: entre las no predeterminadas queda el orden de alta.
    own.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    return Promise.resolve(own.map((address) => ({ ...address })))
  }

  /** {@inheritDoc AddressRepository.findOne} */
  findOne(customerId: string, id: string): Promise<Address | null> {
    const address = this.addresses.find(
      (candidate) => candidate.id === id && candidate.customerId === customerId,
    )
    return Promise.resolve(address === undefined ? null : { ...address })
  }

  /** {@inheritDoc AddressRepository.create} */
  create(input: NewAddress): Promise<Address> {
    const own = this.addresses.filter((address) => address.customerId === input.customerId)
    if (own.length >= MAX_ADDRESSES_PER_CUSTOMER) {
      return Promise.reject(new AddressBookFullError(MAX_ADDRESSES_PER_CUSTOMER))
    }
    if (input.isDefault) this.clearDefault(input.customerId)
    this.addresses.push({ ...input })
    return Promise.resolve({ ...input })
  }

  /** {@inheritDoc AddressRepository.replace} */
  replace(id: string, input: AddressInput): Promise<Address> {
    const index = this.addresses.findIndex((address) => address.id === id)
    const current = this.addresses[index]
    if (current === undefined) return Promise.reject(new Error(`No existe la dirección ${id}`))
    if (input.isDefault) this.clearDefault(current.customerId)
    const replaced: Address = { ...input, id, customerId: current.customerId }
    this.addresses[index] = replaced
    return Promise.resolve({ ...replaced })
  }

  /** {@inheritDoc AddressRepository.delete} */
  delete(id: string): Promise<void> {
    const index = this.addresses.findIndex((address) => address.id === id)
    if (index >= 0) this.addresses.splice(index, 1)
    return Promise.resolve()
  }

  private clearDefault(customerId: string): void {
    for (const [index, address] of this.addresses.entries()) {
      if (address.customerId === customerId && address.isDefault) {
        this.addresses[index] = { ...address, isDefault: false }
      }
    }
  }
}

/** Token de recuperación guardado en memoria (solo el hash, como en la base). */
export interface StoredPasswordResetToken extends NewPasswordResetToken {
  /** Cuándo se usó, o `null` si sigue disponible. */
  usedAt: Date | null
}

/** {@link PasswordResetRepository} en memoria. */
export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  /** Tokens guardados (los tests pueden mirarlos). */
  readonly tokens: StoredPasswordResetToken[] = []

  /** {@inheritDoc PasswordResetRepository.create} */
  create(input: NewPasswordResetToken): Promise<void> {
    this.tokens.push({ ...input, usedAt: null })
    return Promise.resolve()
  }

  /** {@inheritDoc PasswordResetRepository.consume} */
  consume(tokenHash: string, now: Date): Promise<{ userId: string } | null> {
    const token = this.tokens.find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        candidate.usedAt === null &&
        candidate.expiresAt.getTime() > now.getTime(),
    )
    if (token === undefined) return Promise.resolve(null)
    token.usedAt = new Date(now.getTime())
    return Promise.resolve({ userId: token.userId })
  }
}

/** {@link PasswordHasher} de prueba: el hash es `hashed:` + la contraseña. Cuenta las verificaciones. */
export class FakeHasher implements PasswordHasher {
  /** Cuántas veces se llamó a `verify`. */
  verifyCalls = 0

  /** {@inheritDoc PasswordHasher.hash} */
  hash(plain: string): Promise<string> {
    return Promise.resolve(`hashed:${plain}`)
  }

  /** {@inheritDoc PasswordHasher.verify} */
  verify(hash: string, plain: string): Promise<boolean> {
    this.verifyCalls += 1
    return Promise.resolve(hash === `hashed:${plain}`)
  }
}

/** {@link MailerPort} que guarda los mails en memoria en vez de mandarlos. */
export class RecordingMailer implements MailerPort {
  /** Mails de recuperación "enviados", en orden. */
  readonly passwordResets: PasswordResetMail[] = []

  /** {@inheritDoc MailerPort.sendPasswordReset} */
  sendPasswordReset(input: PasswordResetMail): Promise<void> {
    this.passwordResets.push({ ...input })
    return Promise.resolve()
  }
}

/** Intentos de un par email + IP dentro de su ventana. */
interface AttemptWindow {
  count: number
  windowEndsAt: number
}

/**
 * {@link LoginAttemptsPort} en memoria con las reglas del de Redis: cuenta cada intento por email e
 * IP antes de verificar (de forma atómica: suma en el momento de la llamada), la ventana de 15
 * minutos arranca con el primero, el décimo todavía se verifica y del once en adelante el par
 * queda bloqueado hasta que termina. Además, el tope por email (NV-09): lo que el par deja
 * verificar suma a un contador del email de una hora; el intento 100 todavía se verifica y del 101
 * en adelante el email queda bloqueado desde cualquier IP. Si los dos avisan, arranca el más largo.
 */
export class InMemoryLoginAttempts implements LoginAttemptsPort {
  private readonly attempts = new Map<string, AttemptWindow>()

  /**
   * @param clock - Reloj para la ventana.
   * @param limit - Intentos que se verifican por par (10).
   * @param windowSeconds - Duración de la ventana del par en segundos (900).
   * @param emailLimit - Intentos que se verifican por email (100).
   * @param emailWindowSeconds - Duración de la ventana del email en segundos (3600).
   */
  constructor(
    private readonly clock: Clock,
    private readonly limit = 10,
    private readonly windowSeconds = 900,
    private readonly emailLimit = 100,
    private readonly emailWindowSeconds = 3_600,
  ) {}

  /** {@inheritDoc LoginAttemptsPort.attempt} */
  attempt(key: LoginAttemptKey): Promise<LoginAttempt> {
    const pair = this.bump(attemptId(key), this.limit, this.windowSeconds)
    if (pair.blockedForSeconds !== null) return Promise.resolve(pair)
    const email = this.bump(emailId(key.email), this.emailLimit, this.emailWindowSeconds)
    if (email.blockedForSeconds !== null) return Promise.resolve(email)
    const locks = [pair.lockedIfFailsSeconds, email.lockedIfFailsSeconds].filter(
      (seconds) => seconds !== null,
    )
    return Promise.resolve({
      blockedForSeconds: null,
      lockedIfFailsSeconds: locks.length === 0 ? null : Math.max(...locks),
    })
  }

  /** {@inheritDoc LoginAttemptsPort.clear} */
  clear(key: LoginAttemptKey): Promise<void> {
    this.attempts.delete(attemptId(key))
    this.attempts.delete(emailId(key.email))
    return Promise.resolve()
  }

  /**
   * Intentos registrados para un par en la ventana vigente.
   *
   * @param email - Email normalizado.
   * @param clientIp - IP del cliente.
   * @returns La cantidad, o 0 si no hay ventana abierta.
   */
  count(email: string, clientIp: string): number {
    return this.current(attemptId({ email, clientIp }), this.clock.now().getTime())?.count ?? 0
  }

  /** Suma un intento al contador `id` y dice si se verifica, si bloquea al fallar o si ya bloqueó. */
  private bump(id: string, limit: number, windowSeconds: number): LoginAttempt {
    const now = this.clock.now().getTime()
    const entry = this.current(id, now) ?? { count: 0, windowEndsAt: now + windowSeconds * 1000 }
    entry.count += 1
    this.attempts.set(id, entry)
    const remaining = Math.ceil((entry.windowEndsAt - now) / 1000)
    return {
      blockedForSeconds: entry.count > limit ? remaining : null,
      lockedIfFailsSeconds: entry.count === limit ? remaining : null,
    }
  }

  private current(id: string, now: number): AttemptWindow | null {
    const entry = this.attempts.get(id)
    if (entry === undefined || entry.windowEndsAt <= now) return null
    return entry
  }
}

/** Clave del par email + IP. */
function attemptId({ email, clientIp }: LoginAttemptKey): string {
  return `${encodeURIComponent(clientIp)}:${email}`
}

/** Clave del tope por email (no choca con las del par: esas siempre llevan `:`). */
function emailId(email: string): string {
  return `email|${email}`
}
