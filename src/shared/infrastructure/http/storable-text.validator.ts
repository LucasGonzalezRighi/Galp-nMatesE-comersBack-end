import { ValidateBy } from 'class-validator'

import { isStorableText } from '../../domain/storable-text'

/**
 * Rechaza (422 con `code: invalid_format`, como un `@Matches`) un texto libre que Postgres no
 * guarda tal cual (ver {@link isStorableText}): U+0000 o una mitad suelta de un par sustituto. Sin
 * esto, el pedido llegaba a Postgres y fallaba con 500 (NV-12, NV-15 y el `message` del contacto).
 * Si el valor no es texto, no opina: lo rechaza la regla del tipo.
 *
 * Va arriba de las reglas de tipo y largo (class-validator corre los decoradores de abajo hacia
 * arriba), así el primer error de cada campo sigue siendo el mismo que el del front.
 *
 * @param message - Mensaje del error ("Ingresá un texto" en todos los formularios).
 * @returns El decorador de la propiedad.
 */
export function StorableText(message: string): PropertyDecorator {
  return ValidateBy(
    {
      name: 'invalidFormat',
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || isStorableText(value),
      },
    },
    { message },
  )
}
