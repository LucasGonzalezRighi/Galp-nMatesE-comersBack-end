import { UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { AddressBookInputDto } from '../../../modules/identity/interface/dto/address-book-input.dto'
import { ForgotPasswordDto } from '../../../modules/identity/interface/dto/forgot-password.dto'
import { LoginDto } from '../../../modules/identity/interface/dto/login.dto'
import { RegisterDto } from '../../../modules/identity/interface/dto/register.dto'
import { CustomerInputDto } from '../../../modules/orders/interface/dto/customer-input.dto'
import { ReviewInputDto } from '../../../modules/reviews/interface/dto/review-input.dto'
import {
  ContactInputDto,
  WithdrawalInputDto,
} from '../../../modules/support/interface/dto/contact-input.dto'
import type { FieldError } from './problem.filter'
import { createValidationPipe } from './validation.pipe'

/**
 * Textos libres de los formularios públicos (contacto, arrepentimiento, reseña, registro,
 * direcciones, checkout e inicio de sesión) con algo que Postgres no guarda o que rompe la
 * validación: U+0000 y mitades sueltas de un par sustituto. Cada uno tiene que dar 422 en su
 * campo, nunca un 500 (el `message` del contacto llegaba a Postgres y fallaba).
 */

const pipe = createValidationPipe()

/** Lo que no se puede guardar: U+0000 en el medio y las dos mitades sueltas de un par. */
const UNSTORABLE = [
  ['U+0000', (text: string) => `${text.slice(0, 2)}\u0000${text.slice(2)}`],
  ['una mitad alta suelta', (text: string) => `${text}\ud800`],
  ['una mitad baja suelta', (text: string) => `\udfff${text}`],
] as const

/** Un DTO público con un cuerpo válido y los campos de texto libre que hay que revisar. */
interface PublicForm {
  name: string
  dto: new () => object
  valid: Record<string, unknown>
  fields: readonly string[]
}

const FORMS: readonly PublicForm[] = [
  {
    name: 'contacto (ContactInput)',
    dto: ContactInputDto,
    valid: {
      name: 'Lucía Gómez',
      email: 'lucia@example.com',
      orderNumber: null,
      reason: 'Envío',
      message: 'Pedí un mate hace una semana y todavía no llegó.',
      website: null,
    },
    fields: ['name', 'email', 'message'],
  },
  {
    name: 'arrepentimiento (WithdrawalInput)',
    dto: WithdrawalInputDto,
    valid: {
      name: 'Lucía Gómez',
      email: 'lucia@example.com',
      orderNumber: null,
      comment: 'Me arrepentí de la compra.',
      website: null,
    },
    fields: ['name', 'email', 'comment'],
  },
  {
    name: 'reseña (ReviewInput)',
    dto: ReviewInputDto,
    valid: {
      rating: 5,
      authorName: 'Lucía',
      text: 'Un mate hermoso, llegó rápido.',
      website: null,
    },
    fields: ['authorName', 'text'],
  },
  {
    name: 'registro (RegisterInput)',
    dto: RegisterDto,
    valid: {
      email: 'lucia@example.com',
      firstName: 'Lucía',
      lastName: 'Gómez',
      password: 'galpon2026ok',
    },
    fields: ['email', 'firstName', 'lastName'],
  },
  {
    name: 'libreta de direcciones (AddressBookInput)',
    dto: AddressBookInputDto,
    valid: {
      label: 'Casa',
      street: 'Av. Rivadavia',
      number: '4321',
      apartment: '3B',
      postalCode: '1406',
      city: 'Buenos Aires',
      province: 'CABA',
      isDefault: false,
    },
    fields: ['label', 'street', 'apartment', 'city'],
  },
  {
    name: 'contacto del checkout (CustomerInput)',
    dto: CustomerInputDto,
    valid: { email: 'lucia@example.com', firstName: 'Lucía', lastName: 'Gómez', phone: null },
    fields: ['email', 'firstName', 'lastName'],
  },
  {
    name: 'inicio de sesión (LoginInput)',
    dto: LoginDto,
    valid: { email: 'lucia@example.com', password: 'galpon2026ok' },
    fields: ['email'],
  },
  {
    name: 'recuperación de contraseña (ForgotPasswordInput)',
    dto: ForgotPasswordDto,
    valid: { email: 'lucia@example.com' },
    fields: ['email'],
  },
]

/** Pasa el cuerpo por el pipe global como `@Body()`; devuelve los errores del 422 (o `[]`). */
async function errorsOf(dto: new () => object, body: Record<string, unknown>) {
  try {
    await pipe.transform(body, { type: 'body', metatype: dto })
    return []
  } catch (error) {
    if (!(error instanceof UnprocessableEntityException)) throw error
    return (error.getResponse() as { errors: FieldError[] }).errors
  }
}

describe('textos libres públicos que Postgres no guarda → 422 en su campo, nunca 500', () => {
  it.each(FORMS.map((form) => [form.name, form] as const))(
    '%s: el cuerpo válido pasa',
    async (_name, form) => {
      await expect(errorsOf(form.dto, form.valid)).resolves.toEqual([])
    },
  )

  const cases = FORMS.flatMap((form) =>
    form.fields.flatMap((field) =>
      UNSTORABLE.map(([label, broken]) => [form.name, field, label, form, broken] as const),
    ),
  )

  it.each(cases)('%s: %s con %s → 422 en el campo', async (_name, field, _label, form, broken) => {
    const value = form.valid[field]
    if (typeof value !== 'string')
      throw new Error(`El campo ${field} no es texto en el cuerpo válido`)

    const errors = await errorsOf(form.dto, { ...form.valid, [field]: broken(value) })

    expect(errors.map((error) => error.field)).toEqual([field])
  })
})
