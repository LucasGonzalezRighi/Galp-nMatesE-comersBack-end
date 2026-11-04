import { UnprocessableEntityException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ComboInputDto,
  ComboOrderInputDto,
} from '../../src/modules/catalog/interface/dto/combo-input.dto'
import { AddressBookInputDto } from '../../src/modules/identity/interface/dto/address-book-input.dto'
import { AdminLoginDto } from '../../src/modules/identity/interface/dto/admin-login.dto'
import { CustomerUpdateDto } from '../../src/modules/identity/interface/dto/customer-update.dto'
import { ForgotPasswordDto } from '../../src/modules/identity/interface/dto/forgot-password.dto'
import { LoginDto } from '../../src/modules/identity/interface/dto/login.dto'
import { RegisterDto } from '../../src/modules/identity/interface/dto/register.dto'
import { CustomerInputDto } from '../../src/modules/orders/interface/dto/customer-input.dto'
import {
  ShippingInputDto,
  toShippingInput,
} from '../../src/modules/orders/interface/dto/shipping-input.dto'
import { CardPaymentInputDto } from '../../src/modules/payments/interface/dto/card-payment-input.dto'
import type { FieldError } from '../../src/shared/infrastructure/http/problem.filter'
import { createValidationPipe } from '../../src/shared/infrastructure/http/validation.pipe'
import { ADMIN_CATALOG_MAPPINGS } from './b6/admin-catalog'
import { ADMIN_ORDERS_MAPPINGS } from './b6/admin-orders'
import { CONTENT_MAPPINGS } from './b6/content'
import { SUPPORT_MAPPINGS } from './b6/support'
import {
  errorsOf,
  errorsOrAnyMessage,
  type Mapping,
  partialCase,
  pick,
  type ValidationCase,
  wholeCase,
  withoutNulls,
} from './validation-cases.support'

/**
 * Casos de validación compartidos con el front (spec §7 y §9, nivel Contrato): las mismas
 * entradas que corren los schemas de `@galpon/schemas` tienen que dar acá la misma salida (los
 * válidos) y el mismo mensaje por campo (los inválidos), pasando por el `ValidationPipe` global.
 *
 * El archivo `validation-cases.json` está junto al contrato (`CONTRACT_PATH` o, por defecto,
 * `../frontend/docs/api/`). Solo se corren los schemas que tienen un DTO de identidad; el resto
 * (checkout, reseñas, dashboard…) entra con el módulo que los implemente. Un caso válido sin
 * `output` solo tiene que pasar (README del contrato).
 */

type Outcome = { ok: true; value: Record<string, unknown> } | { ok: false; errors: FieldError[] }

const CONTRACT_PATH = resolve(
  process.env.CONTRACT_PATH ?? resolve(__dirname, '../../../frontend/docs/api/openapi.yaml'),
)
const CASES_PATH = resolve(dirname(CONTRACT_PATH), 'validation-cases.json')

const { cases } = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { cases: ValidationCase[] }

/** Campos válidos que se completan cuando el caso solo prueba otros campos del DTO. */
const VALID_REGISTER = { email: 'lucia@example.com', password: 'galpon2026ok' }

/** Pago con tarjeta válido salvo el documento, que pone cada caso de `cardholderSchema`. */
const VALID_CARD_PAYMENT = {
  token: 'sim_APRO_3704_0123456789abcdef0123456789abcdef',
  paymentMethodId: 'visa',
  issuerId: null,
  installments: 1,
}

/** Campos del documento en `cardholderSchema` → su ruta en `CardPaymentInputDto`. */
const DOCUMENT_FIELDS: Readonly<Record<string, string>> = {
  identificationType: 'payer.identification.type',
  identificationNumber: 'payer.identification.number',
}

const pipe = createValidationPipe()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Pasa el cuerpo por el pipe global como lo haría Nest con `@Body()`. */
async function validate(dto: new () => object, body: Record<string, unknown>): Promise<Outcome> {
  try {
    const value: unknown = await pipe.transform(body, { type: 'body', metatype: dto })
    return { ok: true, value: isRecord(value) ? { ...value } : {} }
  } catch (error) {
    if (error instanceof UnprocessableEntityException) {
      const response = error.getResponse()
      if (isRecord(response) && Array.isArray(response.errors)) {
        return { ok: false, errors: response.errors as FieldError[] }
      }
    }
    throw error
  }
}

/** Primer mensaje de cada campo, que es lo que compara el archivo compartido. */
function firstMessages(errors: readonly FieldError[]): Record<string, string> {
  const messages: Record<string, string> = {}
  for (const error of errors) messages[error.field] ??= error.message
  return messages
}

const identity = (value: Record<string, unknown>): Record<string, unknown> => value

const MAPPINGS: readonly Mapping[] = [
  { name: 'RegisterDto (registerSchema)', dto: RegisterDto, check: wholeCase('registerSchema') },
  { name: 'LoginDto (loginSchema)', dto: LoginDto, check: wholeCase('loginSchema') },
  {
    name: 'AdminLoginDto (adminLoginSchema)',
    dto: AdminLoginDto,
    check: wholeCase('adminLoginSchema'),
  },
  {
    // Email: el mismo campo del formulario de contacto y del checkout; el back lo recibe en `forgot`.
    name: 'ForgotPasswordDto (Email)',
    dto: ForgotPasswordDto,
    check: partialCase(['contactSchema', 'checkoutContactSchema'], ['email'], (c) => ({
      body: c.input.email === undefined ? {} : { email: c.input.email },
      output: pick(c.output ?? {}, ['email']),
    })),
  },
  {
    // Nombre y apellido del checkout: el back los recibe al registrarse.
    name: 'RegisterDto (nombre y apellido de checkoutContactSchema)',
    dto: RegisterDto,
    check: partialCase(['checkoutContactSchema'], ['firstName', 'lastName'], (c) => ({
      body: { ...VALID_REGISTER, firstName: c.input.firstName, lastName: c.input.lastName },
      output: { ...VALID_REGISTER, ...pick(c.output ?? {}, ['firstName', 'lastName']) },
    })),
  },
  {
    // Dirección de envío a domicilio: `address.X` del front es `X` en la libreta de direcciones.
    name: 'AddressBookInputDto (address de shippingSchema)',
    dto: AddressBookInputDto,
    // El piso en blanco sale del DTO como '' y `normalizeAddressInput` (dominio) lo pasa a `null`.
    effective: (value) => ({
      ...value,
      apartment: value.apartment === '' ? null : value.apartment,
    }),
    check: (c) => {
      if (c.schema !== 'shippingSchema' || c.input.method !== 'home') return null
      const errors = errorsOf(c, (field) => (field.startsWith('address.') ? field.slice(8) : null))
      if (!c.valid && Object.keys(errors).length === 0) return null
      const address = isRecord(c.input.address) ? c.input.address : {}
      const output = isRecord(c.output?.address) ? c.output.address : {}
      return {
        body: { ...address, label: null, isDefault: false },
        output: { ...withoutNulls(output), isDefault: false },
        errors,
      }
    },
  },
  {
    // Teléfono: la tienda manda a `PATCH /me` el número ya normalizado (10 dígitos), así que de
    // los válidos se prueba la salida del front, y los inválidos tienen el mismo mensaje.
    name: 'CustomerUpdateDto (phone de checkoutContactSchema)',
    dto: CustomerUpdateDto,
    check: (c) => {
      if (c.schema !== 'checkoutContactSchema') return null
      if (c.valid) {
        const phone = c.output?.phone
        return typeof phone === 'string' && phone !== ''
          ? { body: { phone }, output: { phone }, errors: {} }
          : null
      }
      const errors = errorsOf(c, (field) => (field === 'phone' ? field : null))
      return Object.keys(errors).length === 0
        ? null
        : { body: { phone: c.input.phone }, output: {}, errors }
    },
  },
  {
    // Contacto del checkout (`POST /orders`): el DTO entero, con el teléfono normalizado como en
    // el front (vacío o ausente quedan `null`, que la comparación omite como el front).
    name: 'CustomerInputDto (checkoutContactSchema)',
    dto: CustomerInputDto,
    check: wholeCase('checkoutContactSchema'),
  },
  {
    // Envío del checkout (`POST /orders`): el DTO entero. El destino sale como lo guarda el pedido
    // (`toShippingInput`: el retiro queda en `null` aunque llegue una dirección y el piso vacío
    // también) y el front omite esos `null`. El método que no existe no tiene texto fijo en el
    // archivo: solo tiene que fallar `method`.
    name: 'ShippingInputDto (shippingSchema)',
    dto: ShippingInputDto,
    effective: (value) => {
      const { method, address } = toShippingInput(
        value as Pick<ShippingInputDto, 'method' | 'address'>,
      )
      return { method, address: address === null ? null : withoutNulls({ ...address }) }
    },
    check: (c) =>
      c.schema === 'shippingSchema'
        ? { body: c.input, output: c.output ?? {}, errors: errorsOrAnyMessage(c) }
        : null,
  },
  {
    // Documento de quien paga con tarjeta (`POST …/card`): `identificationType` e
    // `identificationNumber` del front son `payer.identification.type` y `.number`, con la regla
    // por tipo (Ruling B-51: al DNI se le quitan puntos y espacios). Solo los casos "Documento"
    // (7 a 16): los de "Titular de la tarjeta" (1 a 6) prueban `cardholderName`, que no llega al
    // back porque viaja dentro del token de Mercado Pago.
    name: 'CardPaymentInputDto (documento de cardholderSchema)',
    dto: CardPaymentInputDto,
    effective: (value) => {
      const payer = isRecord(value.payer) ? value.payer : {}
      const identification = isRecord(payer.identification) ? payer.identification : {}
      return {
        identificationType: identification.type,
        identificationNumber: identification.number,
      }
    },
    check: (c) =>
      c.schema === 'cardholderSchema' && c.name.startsWith('Documento:')
        ? {
            body: {
              ...VALID_CARD_PAYMENT,
              payer: {
                email: 'lucia@example.com',
                identification: {
                  type: c.input.identificationType,
                  number: c.input.identificationNumber,
                },
              },
            },
            output: pick(c.output ?? {}, Object.keys(DOCUMENT_FIELDS)),
            errors: errorsOf(c, (field) => DOCUMENT_FIELDS[field] ?? null),
          }
        : null,
  },
  {
    // Combo del dashboard (`POST /admin/combos` y `PATCH /admin/combos/{id}`): el DTO entero. Un
    // producto sin elegir da `productIds.1` por `EachItem` del pipe global (Ruling B-64).
    name: 'ComboInputDto (comboFormSchema)',
    dto: ComboInputDto,
    check: wholeCase('comboFormSchema'),
  },
  {
    // Orden de los combos (`PUT /admin/combos/order`): el DTO entero; que estén todos lo revisa
    // el caso de uso con la base.
    name: 'ComboOrderInputDto (comboOrderSchema)',
    dto: ComboOrderInputDto,
    check: wholeCase('comboOrderSchema'),
  },
  // B6: cada tarea suma los suyos en su archivo de `b6/`.
  ...CONTENT_MAPPINGS,
  ...ADMIN_ORDERS_MAPPINGS,
  ...SUPPORT_MAPPINGS,
  ...ADMIN_CATALOG_MAPPINGS,
]

describe('casos de validación compartidos con el front', () => {
  for (const mapping of MAPPINGS) {
    const selected = cases.flatMap((validationCase) => {
      const check = mapping.check(validationCase)
      return check === null ? [] : [{ validationCase, check }]
    })

    describe(mapping.name, () => {
      // Si el archivo cambia de forma (un schema renombrado, por ejemplo), que no pase en vacío.
      it('toma casos válidos e inválidos del archivo', () => {
        expect(selected.some(({ validationCase }) => validationCase.valid)).toBe(true)
        expect(selected.some(({ validationCase }) => !validationCase.valid)).toBe(true)
      })

      for (const { validationCase, check } of selected) {
        it(validationCase.name, async () => {
          const outcome = await validate(mapping.dto, check.body)
          if (validationCase.valid) {
            expect(outcome.ok, `esperaba válido: ${JSON.stringify(outcome)}`).toBe(true)
            if (outcome.ok && check.output !== undefined)
              expect(withoutNulls((mapping.effective ?? identity)(outcome.value))).toEqual(
                check.output,
              )
          } else {
            expect(outcome.ok, 'esperaba un 422 y el DTO lo aceptó').toBe(false)
            if (!outcome.ok) {
              expect(pick(firstMessages(outcome.errors), Object.keys(check.errors))).toEqual(
                check.errors,
              )
            }
          }
        })
      }
    })
  }
})
