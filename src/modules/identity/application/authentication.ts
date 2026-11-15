import type {
  NewSession,
  SessionPort,
  SessionRecord,
} from '../../../shared/application/ports/session.port'
import type { Clock } from '../../../shared/domain/clock'
import { normalizeEmail } from '../domain/email'
import {
  AccountDisabledError,
  InvalidCredentialsError,
  LoginLockedError,
} from '../domain/identity-errors'
import type { User, UserRole } from '../domain/user.entity'
import type { LoginAttemptsPort } from './ports/login-attempts.port'
import type { PasswordHasher } from './ports/password-hasher.port'
import type { UserRepository } from './ports/user.repository.port'

/** Email, contraseña e IP de un inicio de sesión. */
export interface Credentials {
  /** Email tal como llegó (se normaliza). */
  email: string
  /** Contraseña en claro. */
  password: string
  /**
   * Cliente (su IPv4 o la red /64 de su IPv6): el bloqueo por intentos cuenta por email y por
   * cliente, y además por email solo (NV-09).
   */
  clientIp: string
}

/** Usuario que pasó {@link authenticate}. */
export interface AuthenticatedUser {
  /** El usuario, ya con los intentos limpios y el inicio de sesión registrado. */
  user: User
  /**
   * Cuándo empezó la comprobación, antes de leer el hash: va en la sesión como `authenticatedAt`,
   * así un cambio de contraseña que corra en el medio la deja sin valor.
   */
  authenticatedAt: Date
}

/** Puertos que usa {@link authenticate}. */
export interface AuthenticationPorts {
  /** Usuarios. */
  users: UserRepository
  /** Hash de contraseñas. */
  hasher: PasswordHasher
  /** Intentos por email e IP. */
  attempts: LoginAttemptsPort
  /** Reloj, para `lastLoginAt`. */
  clock: Clock
}

/** Contraseña con la que se arma el hash fijo contra el que se verifica cuando el email no existe. */
const DUMMY_PASSWORD = 'galpon-sin-cuenta-0000'

/** Hash fijo por hasher (se calcula una vez, con los mismos parámetros que los reales). */
const dummyHashes = new WeakMap<PasswordHasher, string>()

/**
 * Comprueba las credenciales de un usuario de un rol sin revelar si el email existe ni si la
 * cuenta está deshabilitada: con un email desconocido igual verifica contra un hash fijo (mismo
 * costo) y todos los fallos responden lo mismo. Cada intento cuenta para el bloqueo por email e IP
 * y para el tope por email **antes** de verificar (de forma atómica), así los intentos a la vez no
 * pasan el tope.
 *
 * @param ports - Usuarios, hasher, intentos y reloj.
 * @param credentials - Email, contraseña e IP del cliente.
 * @param role - Rol que tiene que tener el usuario.
 * @returns El usuario y cuándo empezó la comprobación.
 * @throws {LoginLockedError} Si el par email + IP o el email (desde cualquier IP) está bloqueado,
 *   o si este fallo lo bloquea.
 * @throws {InvalidCredentialsError} Si el email no existe, la contraseña no coincide, el rol es
 *   otro o la cuenta está deshabilitada ({@link AccountDisabledError}, que se responde igual).
 */
export async function authenticate(
  ports: AuthenticationPorts,
  credentials: Credentials,
  role: UserRole,
): Promise<AuthenticatedUser> {
  const authenticatedAt = ports.clock.now()
  const email = normalizeEmail(credentials.email)
  const key = { email, clientIp: credentials.clientIp }
  const attempt = await ports.attempts.attempt(key)
  if (attempt.blockedForSeconds !== null) {
    throw new LoginLockedError(wholeSeconds(attempt.blockedForSeconds))
  }

  const user = await ports.users.findByEmail(email)
  const matches =
    user === null
      ? await verifyWithoutUser(ports.hasher, credentials.password)
      : await ports.hasher.verify(user.passwordHash, credentials.password)
  if (user === null || !matches || user.role !== role || user.status !== 'active') {
    if (attempt.lockedIfFailsSeconds !== null) {
      throw new LoginLockedError(wholeSeconds(attempt.lockedIfFailsSeconds))
    }
    throw matches && user?.role === role
      ? new AccountDisabledError()
      : new InvalidCredentialsError()
  }

  await ports.attempts.clear(key)
  await ports.users.touchLastLogin(user.id, ports.clock.now())
  return { user, authenticatedAt }
}

/**
 * Rota la sesión al iniciar sesión o registrarse: cierra la actual (la anónima que dio el CSRF, si
 * hay) y abre una nueva, con id y CSRF nuevos.
 *
 * @param sessions - Almacén de sesiones.
 * @param currentSessionId - Id de la sesión actual, o `null`.
 * @param next - Tipo y dueño de la sesión nueva.
 * @returns La sesión nueva.
 */
export async function rotateSession(
  sessions: SessionPort,
  currentSessionId: string | null,
  next: NewSession,
): Promise<SessionRecord> {
  if (currentSessionId !== null) await sessions.destroy(currentSessionId)
  return sessions.create(next)
}

/** Verifica contra el hash fijo para gastar lo mismo que con un usuario real; siempre `false`. */
async function verifyWithoutUser(hasher: PasswordHasher, password: string): Promise<false> {
  let hash = dummyHashes.get(hasher)
  if (hash === undefined) {
    hash = await hasher.hash(DUMMY_PASSWORD)
    dummyHashes.set(hasher, hash)
  }
  await hasher.verify(hash, password)
  return false
}

/** Segundos enteros y positivos para `Retry-After`. */
function wholeSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds))
}
