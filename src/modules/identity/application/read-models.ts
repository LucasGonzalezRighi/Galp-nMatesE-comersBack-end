import type { Province } from '../domain/province'

/** Datos del cliente como los devuelve la API (`Customer` del contrato). */
export interface CustomerView {
  /** Email normalizado. */
  email: string
  /** Nombre. */
  firstName: string
  /** Apellido. */
  lastName: string
  /** Teléfono, o `null` si no lo cargó. */
  phone: string | null
}

/** Dirección de la libreta como la devuelve la API (`Address` del contrato). */
export interface AddressView {
  /** Id de la dirección. */
  id: string
  /** Nombre con el que el cliente la reconoce, o `null`. */
  label: string | null
  /** Calle. */
  street: string
  /** Número, o `S/N`. */
  number: string
  /** Piso o departamento, o `null`. */
  apartment: string | null
  /** Código postal en mayúsculas. */
  postalCode: string
  /** Ciudad o localidad. */
  city: string
  /** Provincia. */
  province: Province
  /** Si es la predeterminada. */
  isDefault: boolean
}
