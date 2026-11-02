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

/** Email y contraseña de un inicio de sesión. */
export interface Credentials {
  /** Email tal como llegó (se normaliza). */
  email: string
  /** Contraseña en claro. */
  password: string
}

/** Puertos que usa {@link authenticate}. */
export interface AuthenticationPorts {
  /** Usuarios. */
  users: UserRepository
  /** Hash de contraseñas. */
  hasher: PasswordHasher
  /** Intentos fallidos por email. */
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
 * costo) y todos los fallos responden lo mismo y cuentan para el bloqueo por email.
 *
 * @param ports - Usuarios, hasher, intentos fallidos y reloj.
 * @param credentials - Email y contraseña.
 * @param role - Rol que tiene que tener el usuario.
 * @returns El usuario, ya con los fallos limpios y el inicio de sesión registrado.
 * @throws {LoginLockedError} Si el email está bloqueado o este fallo lo bloquea.
 * @throws {InvalidCredentialsError} Si el email no existe, la contraseña no coincide, el rol es
 *   otro o la cuenta está deshabilitada ({@link AccountDisabledError}, que se responde igual).
 */
export async function authenticate(
  ports: AuthenticationPorts,
  credentials: Credentials,
  role: UserRole,
): Promise<User> {
  const email = normalizeEmail(credentials.email)
  const blockedFor = await ports.attempts.blockedFor(email)
  if (blockedFor !== null) throw new LoginLockedError(wholeSeconds(blockedFor))

  const user = await ports.users.findByEmail(email)
  const matches =
    user === null
      ? await verifyWithoutUser(ports.hasher, credentials.password)
      : await ports.hasher.verify(user.passwordHash, credentials.password)
  if (user === null || !matches || user.role !== role || user.status !== 'active') {
    const { blockedForSeconds } = await ports.attempts.fail(email)
    if (blockedForSeconds !== null) throw new LoginLockedError(wholeSeconds(blockedForSeconds))
    throw matches && user?.role === role
      ? new AccountDisabledError()
      : new InvalidCredentialsError()
  }

  await ports.attempts.clear(email)
  await ports.users.touchLastLogin(user.id, ports.clock.now())
  return user
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
