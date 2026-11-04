// Líneas del carrito que manda la tienda (`CartItemInput` del contrato): un producto suelto, un
// kit o un combo, según `type`. Los mensajes son los del mock del front
// (`mock/handlers/pricing.ts`); los que el mock deja a zod (tipo de línea, ids y cuero) van en
// español rioplatense. Un `ferrule` (la virola de antes) en `options` es un campo de más: 422
// "Este campo no está permitido." hasta que la tienda vieja recargue (Ruling B-70). Swagger
// publica estos esquemas crudos (`oneOf` con `discriminator`) desde `ORDERS_OPENAPI_SCHEMAS`:
// estas clases solo validan.

import { applyDecorators } from '@nestjs/common'
import { plainToInstance, Transform, type TransformFnParams, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { LEATHERS } from '../../../catalog/domain/product.entity'
import { RawValue } from '../../../identity/interface/dto/identity-fields'
import { ApiSchemaProperty, schemaRef } from '../../../../shared/infrastructure/http/openapi'
import { MAX_TOTAL_ARS } from '../../domain/pricing'
import {
  type CartItem,
  type CartItemOptions,
  type Leather,
  MAX_CART_LINES,
} from '../../domain/cart-line'
import { LINE_TYPES } from '../../domain/order-status'

/** Textos de error de las líneas del carrito (los del mock, y los que el mock deja a zod). */
export const CART_MESSAGES = {
  /** Carrito vacío o que no es una lista. */
  empty: 'Agregá al menos un producto.',
  /** Más de 50 líneas. */
  tooManyLines: `El carrito puede tener hasta ${String(MAX_CART_LINES)} líneas.`,
  /** Cantidad que no es un entero. */
  quantityType: 'La cantidad tiene que ser un número entero.',
  /** Cantidad menor que 1. */
  quantityMin: 'La cantidad tiene que ser al menos 1.',
  /** Cantidad mayor que 20. */
  quantityMax: 'La cantidad no puede pasar de 20.',
  /** `type` que no es `product`, `kit` ni `combo` (o una línea que no es un objeto). */
  lineType: 'El tipo de la línea tiene que ser product, kit o combo.',
  /** Id de producto vacío, largo o que no es texto. */
  productId: 'Elegí un producto válido.',
  /** Id de combo vacío, largo o que no es texto. */
  comboId: 'Elegí un combo válido.',
  /** Cuero que no es uno de los del contrato. */
  leather: 'Elegí el cuero del mate.',
  /** Opciones que no son un objeto. */
  options: 'Elegí el cuero del mate.',
  /** Precio visto que no es un monto entero válido. */
  expectedPrice: 'El precio visto tiene que ser un monto entero en pesos.',
} as const

/** Máximo de unidades de una línea (`quantity.maximum` del contrato). */
const MAX_LINE_QUANTITY = 20

/** Tope de `Pesos` (precio de lista de un producto). */
const MAX_PESOS = 99_999_999

/** Largo máximo de un id de producto o de combo (`productId.maxLength` y `comboId.maxLength`). */
const PRODUCT_ID_MAX_LENGTH = 80

/** Deja validar el campo solo si vino con valor (`null` y ausente pasan). */
const IF_PRESENT = (_object: object, value: unknown): boolean =>
  value !== null && value !== undefined

/** Cantidad de 1 a 20, cruda del JSON (un `"1"` no pasa a número). */
function QuantityField(): PropertyDecorator {
  return applyDecorators(
    RawValue(),
    Max(MAX_LINE_QUANTITY, { message: CART_MESSAGES.quantityMax }),
    Min(1, { message: CART_MESSAGES.quantityMin }),
    IsInt({ message: CART_MESSAGES.quantityType }),
  )
}

/** Id de un producto (o de un combo, con su mensaje): texto de 1 a 80 caracteres, crudo del JSON. */
function ProductIdField(message: string = CART_MESSAGES.productId): PropertyDecorator {
  return applyDecorators(
    RawValue(),
    MaxLength(PRODUCT_ID_MAX_LENGTH, { message }),
    MinLength(1, { message }),
    IsString({ message }),
  )
}

/** Precio de lista visto (opcional): entero de 0 a `max`, crudo del JSON. */
function ExpectedPriceField(max: number): PropertyDecorator {
  const message = CART_MESSAGES.expectedPrice
  return applyDecorators(
    RawValue(),
    ValidateIf(IF_PRESENT),
    Max(max, { message }),
    Min(0, { message }),
    IsInt({ message }),
  )
}

/** Cuero elegido de un mate (`CartItemOptions`). */
export class CartItemOptionsDto {
  /** Color del cuero. */
  @IsIn(LEATHERS, { message: CART_MESSAGES.leather })
  leather!: Leather
}

/** Producto suelto (`ProductCartItemInput`). */
export class ProductCartItemInputDto {
  /** Discriminador: `product`. */
  @IsIn(['product'], { message: CART_MESSAGES.lineType })
  type!: 'product'

  /** Id del producto. */
  @ProductIdField()
  productId!: string

  /** Unidades, de 1 a 20. */
  @QuantityField()
  quantity!: number

  /** Cuero elegido si el producto ofrece cueros; `null` (o ausente) en los demás. */
  @ValidateIf(IF_PRESENT)
  @ValidateNested({ message: CART_MESSAGES.options })
  @Type(() => CartItemOptionsDto)
  options?: CartItemOptionsDto | null

  /** Precio de lista por unidad que la tienda tenía cotizado (`Pesos`); `null` es no mandarlo. */
  @ExpectedPriceField(MAX_PESOS)
  expectedUnitPriceArs?: number | null
}

/** Kit de mate, bombilla y yerba (`KitCartItemInput`). */
export class KitCartItemInputDto {
  /** Discriminador: `kit`. */
  @IsIn(['kit'], { message: CART_MESSAGES.lineType })
  type!: 'kit'

  /** Id del mate. */
  @ProductIdField()
  mateId!: string

  /** Id de la bombilla. */
  @ProductIdField()
  bombillaId!: string

  /** Id de la yerba. */
  @ProductIdField()
  yerbaId!: string

  /** Cuero del mate; `null` (o ausente, como en el mock) si el mate no ofrece cueros. */
  @ValidateIf(IF_PRESENT)
  @IsIn(LEATHERS, { message: CART_MESSAGES.leather })
  leather?: Leather | null

  /** Cantidad de kits, de 1 a 20. */
  @QuantityField()
  quantity!: number

  /** Suma de las tres piezas que la tienda tenía cotizada (`TotalArs`); `null` es no mandarla. */
  @ExpectedPriceField(MAX_TOTAL_ARS)
  expectedUnitPriceArs?: number | null
}

/** Combo (`ComboCartItemInput`): el back usa sus piezas y su precio vigentes. */
export class ComboCartItemInputDto {
  /** Discriminador: `combo`. */
  @IsIn(['combo'], { message: CART_MESSAGES.lineType })
  type!: 'combo'

  /** Id del combo. */
  @ProductIdField(CART_MESSAGES.comboId)
  comboId!: string

  /** Cantidad de combos, de 1 a 20. */
  @QuantityField()
  quantity!: number

  /** Cuero del mate del combo; `null` (o ausente) si no lleva mate o no ofrece cueros. */
  @ValidateIf(IF_PRESENT)
  @ValidateNested({ message: CART_MESSAGES.options })
  @Type(() => CartItemOptionsDto)
  options?: CartItemOptionsDto | null

  /** Precio final por combo que la tienda tenía cotizado (`Pesos`); `null` es no mandarlo. */
  @ExpectedPriceField(MAX_PESOS)
  expectedUnitPriceArs?: number | null
}

/**
 * Línea con un `type` desconocido (o que no es un objeto): solo se conserva `type`, así el único
 * error es el del discriminador y no uno por cada campo que trae.
 */
export class UnknownCartItemInputDto {
  /** Lo que vino en `type`. */
  @IsIn(LINE_TYPES, { message: CART_MESSAGES.lineType })
  type: unknown
}

/** Línea del carrito ya convertida a su clase. */
export type CartItemInputDto = ProductCartItemInputDto | KitCartItemInputDto | ComboCartItemInputDto

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convierte cada línea cruda a la clase que dice su `type` (el discriminador de `CartItemInput`).
 * Se hace con `@Transform` y no con `@Type({ discriminator })` porque class-transformer 0.5.1 lee
 * `línea.type` sin mirar si la línea es `null` y respondería 500 en lugar de 422.
 */
function toItemInstances({ obj, key }: TransformFnParams): unknown {
  const value = (obj as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return value
  return value.map((item: unknown) => {
    if (isRecord(item) && item.type === 'product') {
      return plainToInstance(ProductCartItemInputDto, item)
    }
    if (isRecord(item) && item.type === 'kit') return plainToInstance(KitCartItemInputDto, item)
    if (isRecord(item) && item.type === 'combo') {
      return plainToInstance(ComboCartItemInputDto, item)
    }
    return Object.assign(new UnknownCartItemInputDto(), { type: isRecord(item) ? item.type : null })
  })
}

/**
 * Lista de líneas del carrito (`items` de `CartQuoteInput`, `ShippingQuoteInput` y
 * `CreateOrderInput`): de 1 a 50, cada una validada según su `type`.
 *
 * @returns El decorador de la propiedad.
 */
export function CartItemsField(): PropertyDecorator {
  return applyDecorators(
    ApiSchemaProperty({
      type: 'array',
      minItems: 1,
      maxItems: MAX_CART_LINES,
      items: schemaRef('CartItemInput'),
    }),
    Transform(toItemInstances),
    ValidateNested({ each: true, message: CART_MESSAGES.empty }),
    ArrayMaxSize(MAX_CART_LINES, { message: CART_MESSAGES.tooManyLines }),
    ArrayMinSize(1, { message: CART_MESSAGES.empty }),
    IsArray({ message: CART_MESSAGES.empty }),
  )
}

/**
 * Pasa una línea validada a la del dominio: `options` y el `leather` del kit ausentes quedan
 * `null` y `expectedUnitPriceArs` solo va si vino con un número (ausente y `null` son lo mismo,
 * como en el mock).
 *
 * @param item - Línea ya validada por el pipe.
 * @returns La línea del carrito para los casos de uso.
 */
export function toCartItem(item: CartItemInputDto): CartItem {
  const price = item.expectedUnitPriceArs
  const expected = price === null || price === undefined ? {} : { expectedUnitPriceArs: price }
  if (item.type === 'kit') {
    return {
      type: 'kit',
      mateId: item.mateId,
      bombillaId: item.bombillaId,
      yerbaId: item.yerbaId,
      leather: item.leather ?? null,
      quantity: item.quantity,
      ...expected,
    }
  }
  const options: CartItemOptions | null =
    item.options === null || item.options === undefined ? null : { leather: item.options.leather }
  if (item.type === 'combo') {
    return { type: 'combo', comboId: item.comboId, quantity: item.quantity, options, ...expected }
  }
  return {
    type: 'product',
    productId: item.productId,
    quantity: item.quantity,
    options,
    ...expected,
  }
}
