// Cuerpo de `POST /admin/orders/{number}/status` con las reglas de `orderStatusChangeSchema` del
// front (`frontend/packages/schemas/src/admin.ts`): una unión por `status`. Con `shipped`,
// `carrier` (2 a 40) y `trackingNumber` (4 a 40) recortados y obligatorios (los de
// `dispatchSchema`); con `preparing`, `delivered` o `cancelled`, los dos van en `null`. La nota se
// recorta, hasta 500, y vacía queda en `null`. Los cuatro campos son obligatorios como en el
// contrato (`null` donde se permite; Ruling B-75). Swagger publica el esquema crudo
// (`OrderStatusChange` en `ORDERS_OPENAPI_SCHEMAS`): esta clase solo valida.

import { applyDecorators } from '@nestjs/common'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsIn, ValidateBy, ValidateIf, type ValidationArguments } from 'class-validator'

import { maxMessage, RawValue, Trimmed } from '../../../identity/interface/dto/identity-fields'
import {
  ADMIN_ORDER_TARGETS,
  type AdminOrderTarget,
  isAdminOrderTarget,
} from '../../domain/admin-order-transitions'
import type { OrderStatusChangeInput } from '../../application/commands/change-order-status.command'

/** Textos de error del cambio de estado (los de `MESSAGES` del front). */
export const ORDER_STATUS_CHANGE_MESSAGES = {
  /** Obligatorio vacío, ausente o de otro tipo. */
  required: 'Requerido',
  /** `status` que no es uno de los cuatro destinos del dashboard. */
  invalidTarget: 'Elegí el estado nuevo del pedido',
  /** Empresa o seguimiento en un cambio que no es un despacho. */
  onlyWhenShipped: 'Solo se completa al despachar el pedido',
} as const

/** Largo máximo de la nota del historial. */
export const ORDER_NOTE_MAX_LENGTH = 500

/**
 * Texto de "demasiado corto", como `MESSAGES.min` del front.
 *
 * @param min - Cantidad mínima de caracteres.
 * @returns `Mínimo <min> caracteres`.
 */
function minMessage(min: number): string {
  return `Mínimo ${String(min)} caracteres`
}

/** El `status` del cuerpo, si es uno de los destinos. */
function targetOf(args: ValidationArguments): AdminOrderTarget | null {
  const status: unknown = (args.object as Record<string, unknown>).status
  return isAdminOrderTarget(status) ? status : null
}

/** Con un `status` que no es un destino solo vale ese error (como la unión del front). */
const OnlyWithKnownTarget = ValidateIf((object: Record<string, unknown>) =>
  isAdminOrderTarget(object.status),
)

/**
 * Regla con nombre y mensaje propios; recibe el valor y el destino del cuerpo.
 *
 * @param name - Nombre de la restricción (da el `code` del error).
 * @param message - Mensaje en español.
 * @param isValid - Si el valor cumple la regla.
 */
function Rule(
  name: string,
  message: string,
  isValid: (value: unknown, target: AdminOrderTarget | null) => boolean,
): PropertyDecorator {
  return ValidateBy(
    {
      name,
      validator: { validate: (value, args) => isValid(value, args ? targetOf(args) : null) },
    },
    { message },
  )
}

/** El campo tiene que venir (puede venir en `null`): ausente da "Requerido". */
const Present = Rule(
  'isDefined',
  ORDER_STATUS_CHANGE_MESSAGES.required,
  (value) => value !== undefined,
)

/**
 * Empresa o seguimiento del despacho: con `shipped`, texto recortado obligatorio de `min` a `max`
 * (vacío da solo "Requerido"); con los demás destinos, `null` ("Solo se completa al despachar el
 * pedido").
 *
 * @param min - Mínimo de caracteres.
 * @param max - Máximo de caracteres.
 * @returns El decorador de la propiedad.
 */
function DispatchField(min: number, max: number): PropertyDecorator {
  const { required, onlyWhenShipped } = ORDER_STATUS_CHANGE_MESSAGES
  const shipping = (target: AdminOrderTarget | null): boolean => target === 'shipped'
  return applyDecorators(
    Trimmed(),
    OnlyWithKnownTarget,
    Present,
    Rule(
      'isNull',
      onlyWhenShipped,
      (value, target) => shipping(target) || value === null || value === undefined,
    ),
    Rule(
      'isString',
      required,
      (value, target) => !shipping(target) || value === undefined || typeof value === 'string',
    ),
    Rule('isNotEmpty', required, (value, target) => !shipping(target) || value !== ''),
    Rule(
      'minLength',
      minMessage(min),
      (value, target) =>
        !shipping(target) || typeof value !== 'string' || value === '' || value.length >= min,
    ),
    Rule(
      'maxLength',
      maxMessage(max),
      (value, target) => !shipping(target) || typeof value !== 'string' || value.length <= max,
    ),
  )
}

/** Nota cruda recortada; vacía queda en `null` (lo que no es texto queda como vino). */
function trimmedNote({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Cambio de estado de un pedido que pide el dashboard (`OrderStatusChange`). */
export class OrderStatusChangeDto {
  /** Estado nuevo: `preparing`, `shipped`, `delivered` o `cancelled`. */
  @RawValue()
  @IsIn(ADMIN_ORDER_TARGETS, { message: ORDER_STATUS_CHANGE_MESSAGES.invalidTarget })
  status!: AdminOrderTarget

  /** Empresa de transporte (2 a 40), solo al despachar. */
  @DispatchField(2, 40)
  carrier!: string | null

  /** Número de seguimiento (4 a 40), solo al despachar. */
  @DispatchField(4, 40)
  trackingNumber!: string | null

  /** Nota del historial (hasta 500), o `null`. */
  @Transform(trimmedNote)
  @OnlyWithKnownTarget
  @Rule(
    'maxLength',
    maxMessage(ORDER_NOTE_MAX_LENGTH),
    (value) => typeof value !== 'string' || value.length <= ORDER_NOTE_MAX_LENGTH,
  )
  @Rule(
    'isString',
    ORDER_STATUS_CHANGE_MESSAGES.required,
    (value) => value === undefined || value === null || typeof value === 'string',
  )
  @Present
  note!: string | null

  /**
   * El cambio para `ChangeOrderStatusCommand`.
   *
   * @returns Estado, empresa, seguimiento y nota ya normalizados.
   */
  toInput(): OrderStatusChangeInput {
    return {
      status: this.status,
      carrier: this.carrier,
      trackingNumber: this.trackingNumber,
      note: this.note,
    }
  }
}
