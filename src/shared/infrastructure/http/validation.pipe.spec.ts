import { UnprocessableEntityException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsString, ValidateNested } from 'class-validator'
import { describe, expect, it } from 'vitest'

import type { FieldError } from './problem.filter'
import { createValidationPipe, EachItem, type ItemRule } from './validation.pipe'

/** Regla de prueba: cada elemento es un texto con algo. */
const REQUIRED_ITEM: ItemRule = {
  name: 'testRequiredItem',
  code: 'required',
  message: 'Requerido',
  isValid: (item) => typeof item === 'string' && item.trim() !== '',
}

/** Regla de prueba: cada elemento tiene hasta 3 caracteres. */
const SHORT_ITEM: ItemRule = {
  name: 'testShortItem',
  code: 'too_big',
  message: 'Máximo 3 caracteres',
  isValid: (item) => typeof item !== 'string' || item.length <= 3,
}

// Los decoradores apilados se aplican de abajo hacia arriba: ese es el orden de los errores.
class ListDto {
  @EachItem(SHORT_ITEM)
  @EachItem(REQUIRED_ITEM)
  @ArrayMinSize(2, { message: 'Mínimo 2' })
  @IsArray({ message: 'Tiene que ser una lista' })
  ids!: string[]

  @IsInt({ message: 'Entero' })
  count!: number
}

class ParentDto {
  @ValidateNested()
  @Type(() => ListDto)
  list!: ListDto
}

class PlainDto {
  @IsString({ each: true, message: 'Textos' })
  names!: string[]
}

const pipe = createValidationPipe()

/** Pasa el cuerpo por el pipe global y devuelve los errores del 422 (o `[]` si pasó). */
async function errorsOf(metatype: new () => object, body: unknown): Promise<FieldError[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype })
    return []
  } catch (error) {
    if (!(error instanceof UnprocessableEntityException)) throw error
    return (error.getResponse() as { errors: FieldError[] }).errors
  }
}

describe('createValidationPipe con EachItem (errores por índice, Ruling B-64)', () => {
  it('pone el error en campo.<índice> de cada elemento que no cumple la regla', async () => {
    const errors = await errorsOf(ListDto, { ids: ['a', ' ', 'b', ''], count: 1 })

    expect(errors).toEqual([
      { field: 'ids.1', code: 'required', message: 'Requerido' },
      { field: 'ids.3', code: 'required', message: 'Requerido' },
    ])
  })

  it('cada regla marca sus elementos y convive con las restricciones de la lista', async () => {
    const errors = await errorsOf(ListDto, { ids: ['larguísimo'], count: 'x' })

    expect(errors).toEqual([
      { field: 'ids', code: 'too_small', message: 'Mínimo 2' },
      { field: 'ids.0', code: 'too_big', message: 'Máximo 3 caracteres' },
      { field: 'count', code: 'invalid_type', message: 'Entero' },
    ])
  })

  it('en un objeto anidado lleva la ruta completa', async () => {
    const errors = await errorsOf(ParentDto, { list: { ids: ['a', 7], count: 1 } })

    expect(errors).toEqual([{ field: 'list.ids.1', code: 'required', message: 'Requerido' }])
  })

  it('si el valor no es una lista, la regla no marca nada (lo marca IsArray)', async () => {
    const errors = await errorsOf(ListDto, { ids: 'a', count: 1 })

    expect(errors).toEqual([
      { field: 'ids', code: 'invalid_type', message: 'Tiene que ser una lista' },
      { field: 'ids', code: 'too_small', message: 'Mínimo 2' },
    ])
  })

  it('con todos los elementos válidos no hay errores', async () => {
    await expect(errorsOf(ListDto, { ids: ['a', 'b'], count: 1 })).resolves.toEqual([])
  })

  it('las restricciones con each de class-validator siguen en el campo de la lista', async () => {
    const errors = await errorsOf(PlainDto, { names: ['a', 1] })

    expect(errors).toEqual([{ field: 'names', code: 'invalid_type', message: 'Textos' }])
  })

  it('EachItem rechaza una regla sin nombre, código o mensaje', () => {
    expect(() => EachItem({ ...REQUIRED_ITEM, name: ' ' })).toThrow(TypeError)
    expect(() => EachItem({ ...REQUIRED_ITEM, code: '' })).toThrow(TypeError)
    expect(() => EachItem({ ...REQUIRED_ITEM, message: '' })).toThrow(TypeError)
  })
})
