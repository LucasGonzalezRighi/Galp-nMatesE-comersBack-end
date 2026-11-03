import { PickType } from '@nestjs/swagger'

import { AddressInputDto } from '../../../../shared/infrastructure/http/address-input.dto'

/**
 * Destino de un envío a sucursal (`BranchAddressInput` del contrato): solo código postal, ciudad
 * y provincia, con las mismas reglas que la dirección completa. Como el contrato lo declara con
 * `additionalProperties: false`, un campo de más (por ejemplo `street`) responde 422
 * `unrecognized_key`. Swagger lo publica crudo desde `ORDERS_OPENAPI_SCHEMAS`.
 */
export class BranchAddressInputDto extends PickType(AddressInputDto, [
  'postalCode',
  'city',
  'province',
] as const) {}
