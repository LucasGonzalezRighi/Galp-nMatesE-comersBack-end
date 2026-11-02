import {
  Prisma,
  type Address as AddressRow,
  type Customer as CustomerRow,
  type Province as DbProvince,
  type User as UserRow,
} from '../../../generated/prisma/client'
import type { Address, AddressInput } from '../domain/address.entity'
import type { Customer } from '../domain/customer.entity'
import { EmailAlreadyRegisteredError } from '../domain/identity-errors'
import type { Province } from '../domain/province'
import type { User } from '../domain/user.entity'

/** Texto de cada provincia del contrato → su valor del enum `province` de Prisma. */
const PROVINCE_TO_DB = {
  'Buenos Aires': 'buenos_aires',
  CABA: 'caba',
  Catamarca: 'catamarca',
  Chaco: 'chaco',
  Chubut: 'chubut',
  Córdoba: 'cordoba',
  Corrientes: 'corrientes',
  'Entre Ríos': 'entre_rios',
  Formosa: 'formosa',
  Jujuy: 'jujuy',
  'La Pampa': 'la_pampa',
  'La Rioja': 'la_rioja',
  Mendoza: 'mendoza',
  Misiones: 'misiones',
  Neuquén: 'neuquen',
  'Río Negro': 'rio_negro',
  Salta: 'salta',
  'San Juan': 'san_juan',
  'San Luis': 'san_luis',
  'Santa Cruz': 'santa_cruz',
  'Santa Fe': 'santa_fe',
  'Santiago del Estero': 'santiago_del_estero',
  'Tierra del Fuego': 'tierra_del_fuego',
  Tucumán: 'tucuman',
} as const satisfies Record<Province, DbProvince>

/** El camino inverso de {@link PROVINCE_TO_DB}. */
const PROVINCE_FROM_DB = Object.fromEntries(
  Object.entries(PROVINCE_TO_DB).map(([text, value]) => [value, text]),
) as Record<DbProvince, Province>

/**
 * Pasa una provincia del dominio al enum de Prisma.
 *
 * @param province - Texto exacto del contrato.
 * @returns El valor del enum `province`.
 */
export function toDbProvince(province: Province): DbProvince {
  return PROVINCE_TO_DB[province]
}

/**
 * Pasa una fila de `users` al usuario del dominio.
 *
 * @param row - Fila de Prisma.
 * @returns El usuario.
 */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    lastLoginAt: row.lastLoginAt,
  }
}

/**
 * Pasa una fila de `customers` al cliente del dominio (sin las columnas de documento, que B3 no
 * expone).
 *
 * @param row - Fila de Prisma.
 * @returns El cliente.
 */
export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
  }
}

/**
 * Pasa una fila de `addresses` a la dirección del dominio.
 *
 * @param row - Fila de Prisma.
 * @returns La dirección, con la provincia en el texto del contrato.
 */
export function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    street: row.street,
    number: row.number,
    apartment: row.apartment,
    postalCode: row.postalCode,
    city: row.city,
    province: PROVINCE_FROM_DB[row.province],
    isDefault: row.isDefault,
  }
}

/**
 * Columnas de una dirección para escribirla con Prisma.
 *
 * @param input - Datos de la dirección.
 * @returns Los datos con la provincia en el enum de Prisma.
 */
export function toAddressData(
  input: AddressInput,
): Omit<AddressRow, 'id' | 'customerId' | 'createdAt' | 'updatedAt'> {
  return {
    label: input.label,
    street: input.street,
    number: input.number,
    apartment: input.apartment,
    postalCode: input.postalCode,
    city: input.city,
    province: toDbProvince(input.province),
    isDefault: input.isDefault,
  }
}

/**
 * Indica si un error de Prisma es una violación de unicidad (`P2002`).
 *
 * @param error - Lo que se atrapó.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Ejecuta una escritura que crea un usuario y traduce la unicidad del email a un 409.
 *
 * @param write - La escritura.
 * @returns Lo que devuelve la escritura.
 * @throws {EmailAlreadyRegisteredError} Si la base rechaza el email por repetido.
 */
export async function translateEmailTaken<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError()
    throw error
  }
}
