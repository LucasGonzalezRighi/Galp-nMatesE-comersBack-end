import { UnprocessableEntityException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { registerDecorator } from 'class-validator'

import type { FieldError } from './problem.filter'

/**
 * Regla de cada elemento de una lista, como `z.array(regla)` de los schemas del front: el error
 * va en `campo.<índice>` de cada elemento que no la cumple (por ejemplo `productIds.1`
 * "Requerido"), no en la lista. Ver {@link EachItem}.
 */
export interface ItemRule {
  /** Nombre de la restricción en `class-validator` (uno por regla). */
  name: string
  /** Código del `FieldError` de cada elemento que falla (por ejemplo `required`). */
  code: string
  /** Mensaje en español de cada elemento que falla. */
  message: string
  /**
   * Indica si un elemento cumple la regla. Es lo único que decide qué elementos fallan: lo usan la
   * validación y {@link toFieldErrors}.
   */
  isValid: (item: unknown) => boolean
}

/** Clave del `context` de `class-validator` donde viaja la regla de {@link EachItem}. */
const ITEM_RULE_CONTEXT = 'eachItem'

/**
 * Valida cada elemento de una lista con una regla. Si alguno falla, el pipe global responde un
 * error por elemento en `campo.<índice>`, con el código y el mensaje de la regla (Ruling B-64).
 * Si el valor no es una lista, la regla no marca nada: eso lo dice `@IsArray`.
 *
 * Mecanismo: la regla viaja en el `context` de la restricción y {@link toFieldErrors} la vuelve a
 * aplicar sobre el valor que falló para saber qué índices marcar. Solo cambian los DTOs que usan
 * este decorador.
 *
 * @param rule - Regla de cada elemento.
 * @returns El decorador de la propiedad.
 * @throws {TypeError} En español, si la regla no tiene nombre, código o mensaje.
 */
export function EachItem(rule: ItemRule): PropertyDecorator {
  for (const key of ['name', 'code', 'message'] as const) {
    if (rule[key].trim() === '') {
      throw new TypeError(`La regla de cada elemento necesita ${key}`)
    }
  }
  return (target, propertyKey) => {
    registerDecorator({
      name: rule.name,
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: rule.message, context: { [ITEM_RULE_CONTEXT]: rule } },
      validator: {
        validate: (value: unknown) => !Array.isArray(value) || value.every(rule.isValid),
      },
    })
  }
}

function isItemRule(value: unknown): value is ItemRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ItemRule>).code === 'string' &&
    typeof (value as Partial<ItemRule>).isValid === 'function'
  )
}

/** Regla de {@link EachItem} de una restricción que falló, o `undefined` si no es una de esas. */
function itemRuleOf(error: ValidationError, constraint: string): ItemRule | undefined {
  const contexts: Record<string, unknown> = error.contexts ?? {}
  const context = contexts[constraint]
  if (typeof context !== 'object' || context === null) return undefined
  const rule: unknown = Reflect.get(context, ITEM_RULE_CONTEXT)
  return isItemRule(rule) ? rule : undefined
}

/**
 * Regla sobre el objeto entero (un error "de raíz", como el `.refine` de un `z.object` del front):
 * por ejemplo, "Mandá al menos un cambio" cuando un `PATCH` llega sin ningún campo. Ver
 * {@link RootRule}.
 */
export interface RootRuleOptions {
  /** Nombre de la restricción en `class-validator` (uno por regla). */
  name: string
  /** Código del `FieldError` (por ejemplo `empty_update`). */
  code: string
  /** Mensaje en español. */
  message: string
  /** Indica si el objeto, ya transformado por el DTO, cumple la regla. */
  isValid: (value: object) => boolean
}

/** Clave del `context` de `class-validator` donde viaja la regla de {@link RootRule}. */
const ROOT_RULE_CONTEXT = 'rootRule'

/**
 * Propiedad donde se registra la regla de raíz. Es la clave vacía: con `forbidNonWhitelisted`,
 * cualquier propiedad registrada queda permitida, así que si un cuerpo trae la clave `""` la regla
 * falla y {@link toFieldErrors} la responde como un campo no permitido.
 */
const ROOT_PROPERTY = ''

/**
 * Valida el objeto entero con una regla. Si no la cumple, el pipe global responde un error con
 * `field: ''` (en un objeto anidado, la ruta del objeto), el código y el mensaje de la regla,
 * como los errores de raíz de zod (Ruling B-80). Sale después de los errores de los campos.
 *
 * Mecanismo: la regla se registra como una restricción de `class-validator` sobre la clave vacía
 * (que ningún DTO usa), con la regla en el `context`; la validación recibe el objeto entero en
 * `args.object` y {@link toFieldErrors} reconoce el `context` para poner el error en la raíz. Solo
 * cambian los DTOs que usan este decorador.
 *
 * @param rule - Regla del objeto.
 * @returns El decorador de la clase.
 * @throws {TypeError} En español, si la regla no tiene nombre, código o mensaje.
 */
export function RootRule(rule: RootRuleOptions): ClassDecorator {
  for (const key of ['name', 'code', 'message'] as const) {
    if (rule[key].trim() === '') {
      throw new TypeError(`La regla de raíz necesita ${key}`)
    }
  }
  return (target) => {
    registerDecorator({
      name: rule.name,
      target,
      propertyName: ROOT_PROPERTY,
      options: { message: rule.message, context: { [ROOT_RULE_CONTEXT]: rule } },
      validator: {
        validate: (value: unknown, args) =>
          value === undefined && typeof args?.object === 'object' && rule.isValid(args.object),
      },
    })
  }
}

function isRootRule(value: unknown): value is RootRuleOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<RootRuleOptions>).code === 'string' &&
    typeof (value as Partial<RootRuleOptions>).isValid === 'function'
  )
}

/** Regla de {@link RootRule} de una restricción que falló, o `undefined` si no es una de esas. */
function rootRuleOf(error: ValidationError, constraint: string): RootRuleOptions | undefined {
  const contexts: Record<string, unknown> = error.contexts ?? {}
  const context = contexts[constraint]
  if (typeof context !== 'object' || context === null) return undefined
  const rule: unknown = Reflect.get(context, ROOT_RULE_CONTEXT)
  return isRootRule(rule) ? rule : undefined
}

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
  ['matches', 'invalid_format'],
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
 * con la ruta del campo con puntos (`customer.email`, `items.0.quantity`). Las de
 * {@link EachItem} dan un error por elemento que falla, en `campo.<índice>`, y las de
 * {@link RootRule}, uno en la ruta del objeto (`''` en la raíz).
 *
 * @param errors - Errores de validación (pueden venir anidados en `children`).
 * @param parent - Ruta del objeto que los contiene; vacía en la raíz.
 * @returns Los errores por campo, en el orden en que llegaron.
 */
export function toFieldErrors(errors: readonly ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent === '' ? error.property : `${parent}.${error.property}`
    const own = Object.entries(error.constraints ?? {}).flatMap(([constraint, message]) => {
      const value: unknown = error.value
      const root = rootRuleOf(error, constraint)
      if (root !== undefined) {
        return value === undefined
          ? [{ field: parent, code: root.code, message }]
          : [{ field, code: codeFor('whitelistValidation'), message: UNKNOWN_FIELD_MESSAGE }]
      }
      const rule = itemRuleOf(error, constraint)
      if (rule !== undefined && Array.isArray(value)) {
        return value.flatMap((item: unknown, index) =>
          rule.isValid(item)
            ? []
            : [{ field: `${field}.${String(index)}`, code: rule.code, message }],
        )
      }
      return [
        {
          field,
          code: codeFor(constraint),
          message: constraint === 'whitelistValidation' ? UNKNOWN_FIELD_MESSAGE : message,
        },
      ]
    })
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
 * salen de los decoradores de cada DTO, en español (`@IsInt({ message: '…' })`). Los errores
 * llevan el valor que falló (`validationError.value`, el default de `class-validator`, explícito
 * acá) porque {@link EachItem} lo necesita para marcar los índices.
 *
 * @returns El `ValidationPipe` configurado.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    validationError: { target: false, value: true },
    exceptionFactory: (errors) => validationProblem(toFieldErrors(errors)),
  })
}
