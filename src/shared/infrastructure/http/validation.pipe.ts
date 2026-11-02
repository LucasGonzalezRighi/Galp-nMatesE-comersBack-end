import { UnprocessableEntityException, ValidationPipe, type ValidationError } from '@nestjs/common'

import type { FieldError } from './problem.filter'

/**
 * Código de cada restricción de `class-validator` en el `FieldError`, alineado con los de los
 * schemas de zod del front (`too_small`, `too_big`, `invalid_type`…). Las que no están acá se
 * pasan a `snake_case` (por ejemplo `isPhoneNumber` → `is_phone_number`).
 */
const CONSTRAINT_CODES: ReadonlyMap<string, string> = new Map([
  ['whitelistValidation', 'unrecognized_key'],
  ['isDefined', 'required'],
  ['isNotEmpty', 'required'],
  ['min', 'too_small'],
  ['minLength', 'too_small'],
  ['arrayMinSize', 'too_small'],
  ['max', 'too_big'],
  ['maxLength', 'too_big'],
  ['arrayMaxSize', 'too_big'],
  ['isInt', 'invalid_type'],
  ['isNumber', 'invalid_type'],
  ['isString', 'invalid_type'],
  ['isBoolean', 'invalid_type'],
  ['isArray', 'invalid_type'],
  ['isEmail', 'invalid_email'],
  ['isUuid', 'invalid_uuid'],
  ['isEnum', 'invalid_value'],
  ['isIn', 'invalid_value'],
])

/** Mensaje en español de un campo que no está en el DTO (`forbidNonWhitelisted`). */
export const UNKNOWN_FIELD_MESSAGE = 'Este campo no está permitido.'

function codeFor(constraint: string): string {
  return (
    CONSTRAINT_CODES.get(constraint) ??
    constraint.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  )
}

/**
 * Pasa los errores de `class-validator` a `FieldError[]`: un error por restricción que falló,
 * con la ruta del campo con puntos (`customer.email`, `items.0.quantity`).
 *
 * @param errors - Errores de validación (pueden venir anidados en `children`).
 * @param parent - Ruta del objeto que los contiene; vacía en la raíz.
 * @returns Los errores por campo, en el orden en que llegaron.
 */
export function toFieldErrors(errors: readonly ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent === '' ? error.property : `${parent}.${error.property}`
    const own = Object.entries(error.constraints ?? {}).map(([constraint, message]) => ({
      field,
      code: codeFor(constraint),
      message: constraint === 'whitelistValidation' ? UNKNOWN_FIELD_MESSAGE : message,
    }))
    return [...own, ...toFieldErrors(error.children ?? [], field)]
  })
}

/**
 * Excepción de validación: el `ProblemFilter` la responde como 422 `validation_error` con
 * `errors[]`.
 *
 * @param errors - Errores por campo, con mensajes en español.
 * @returns La excepción lista para lanzar.
 */
export function validationProblem(errors: FieldError[]): UnprocessableEntityException {
  return new UnprocessableEntityException({ type: 'validation_error', errors })
}

/**
 * Pipe de validación global: descarta y rechaza campos que no están en el DTO, convierte los
 * tipos (los query params llegan como texto) y responde 422 con un error por campo. Los mensajes
 * salen de los decoradores de cada DTO, en español (`@IsInt({ message: '…' })`).
 *
 * @returns El `ValidationPipe` configurado.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors) => validationProblem(toFieldErrors(errors)),
  })
}
