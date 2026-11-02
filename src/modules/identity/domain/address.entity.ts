import { isProvince, type Province } from './province'

/** Datos de una dirección de la libreta, sin id ni dueño (el `AddressBookInput` del contrato). */
export interface AddressInput {
  /** Nombre con el que el cliente la reconoce ("Casa", "Trabajo"), o `null`. */
  label: string | null
  /** Calle. */
  street: string
  /** Número de 1 a 5 dígitos, o `S/N`. */
  number: string
  /** Piso o departamento, o `null`. */
  apartment: string | null
  /** Código postal en mayúsculas (`1414`, `B1900`, `C1414ABC`). */
  postalCode: string
  /** Ciudad o localidad. */
  city: string
  /** Provincia. */
  province: Province
  /** Si es la predeterminada: el cliente tiene a lo sumo una. */
  isDefault: boolean
}

/** Dirección guardada en la libreta de un cliente. */
export interface Address extends AddressInput {
  /** Id de la dirección (UUID v7). */
  id: string
  /** Cliente dueño. */
  customerId: string
}

/**
 * Normaliza una dirección como el front: textos sin espacios alrededor, número y código postal en
 * mayúsculas, y etiqueta o departamento vacíos como `null` (el formato lo valida la interfaz).
 *
 * @param input - Dirección tal como llegó.
 * @returns Una copia normalizada.
 * @throws {TypeError} En español, si la calle, el número, el código postal o la ciudad quedan
 *   vacíos o la provincia no es una del contrato.
 */
export function normalizeAddressInput(input: AddressInput): AddressInput {
  if (!isProvince(input.province)) {
    throw new TypeError(`La provincia "${String(input.province)}" no es válida`)
  }
  return {
    label: optionalText(input.label),
    street: requiredText(input.street, 'La calle'),
    number: requiredText(input.number, 'El número').toUpperCase(),
    apartment: optionalText(input.apartment),
    postalCode: requiredText(input.postalCode, 'El código postal').toUpperCase(),
    city: requiredText(input.city, 'La ciudad'),
    province: input.province,
    isDefault: input.isDefault,
  }
}

function requiredText(value: string, field: string): string {
  const text = value.trim()
  if (text === '') {
    throw new TypeError(`${field} no puede estar vacío`)
  }
  return text
}

function optionalText(value: string | null): string | null {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}
