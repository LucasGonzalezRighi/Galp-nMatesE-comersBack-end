import type { User, UserRole, UserStatus } from '../../domain/user.entity'

/** Datos de un usuario nuevo; el id lo genera la app (UUID v7). */
export interface NewUser {
  /** Id del usuario. */
  id: string
  /** Email normalizado. */
  email: string
  /** Hash de la contraseña. */
  passwordHash: string
  /** Rol. */
  role: UserRole
  /** Estado. */
  status: UserStatus
}

/** Usuarios con credenciales (la tabla `users`). */
export interface UserRepository {
  /**
   * Busca un usuario por email, sin importar mayúsculas.
   *
   * @param email - Email normalizado.
   */
  findByEmail(email: string): Promise<User | null>

  /**
   * Busca un usuario por id.
   *
   * @param id - Id del usuario.
   */
  findById(id: string): Promise<User | null>

  /**
   * Crea un usuario suelto (sin cliente), sin verificar el email y sin último inicio de sesión. Es
   * para el seed y otros usos: el registro de clientes NO lo usa, porque necesita que usuario y
   * cliente se creen juntos (`CustomerRepository.createWithUser`).
   *
   * @param input - Datos del usuario.
   * @returns El usuario creado.
   * @throws {EmailAlreadyRegisteredError} Si ya hay un usuario con ese email (también cuando dos
   *   registros compiten y la unicidad de la base rechaza el segundo).
   */
  create(input: NewUser): Promise<User>

  /**
   * Reemplaza el hash de la contraseña.
   *
   * @param id - Id del usuario.
   * @param passwordHash - Hash nuevo.
   */
  updatePassword(id: string, passwordHash: string): Promise<void>

  /**
   * Registra un inicio de sesión.
   *
   * @param id - Id del usuario.
   * @param at - Cuándo entró.
   */
  touchLastLogin(id: string, at: Date): Promise<void>
}

/** Token de inyección del {@link UserRepository}. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY')
