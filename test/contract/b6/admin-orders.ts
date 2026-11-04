// Operaciones y casos de validación de los pedidos del dashboard (Task 3 de B6). Los suman
// `openapi.contract.spec.ts` y `validation-cases.contract.spec.ts`.

import { OrderStatusChangeDto } from '../../../src/modules/orders/interface/dto/order-status-change.dto'
import {
  type Check,
  type Mapping,
  partialCase,
  pick,
  type ValidationCase,
  wholeCase,
  withoutNulls,
} from '../validation-cases.support'

/** Operaciones de los pedidos del dashboard que el back ya implementa. */
export const ADMIN_ORDERS_PATHS: readonly string[] = [
  'GET /admin/orders',
  'GET /admin/orders/{number}',
  'POST /admin/orders/{number}/status',
]

/**
 * Como {@link wholeCase}, pero la salida esperada también pierde los `null` de la raíz (la spec
 * se los saca a la salida del DTO): `carrier`, `trackingNumber` y `note` en `null` son parte de
 * la salida del front.
 */
function wholeNullableCase(schema: string): (validationCase: ValidationCase) => Check | null {
  const check = wholeCase(schema)
  return (validationCase) => {
    const built = check(validationCase)
    if (built === null) return null
    return {
      ...built,
      output: built.output === undefined ? undefined : withoutNulls(built.output),
    }
  }
}

/** DTOs de los pedidos del dashboard contra los casos compartidos. */
export const ADMIN_ORDERS_MAPPINGS: readonly Mapping[] = [
  {
    // Cambio de estado (`POST /admin/orders/{number}/status`): el DTO entero.
    name: 'OrderStatusChangeDto (orderStatusChangeSchema)',
    dto: OrderStatusChangeDto,
    check: wholeNullableCase('orderStatusChangeSchema'),
  },
  {
    // Empresa y seguimiento del despacho: los mismos campos con `status: 'shipped'`.
    name: 'OrderStatusChangeDto (dispatchSchema en un despacho)',
    dto: OrderStatusChangeDto,
    check: partialCase(['dispatchSchema'], ['carrier', 'trackingNumber'], (c) => ({
      body: {
        status: 'shipped',
        carrier: c.input.carrier,
        trackingNumber: c.input.trackingNumber,
        note: null,
      },
      output: { status: 'shipped', ...pick(c.output ?? {}, ['carrier', 'trackingNumber']) },
    })),
  },
]
