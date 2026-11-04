import { UnprocessableEntityException } from '@nestjs/common'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { describe, expect, it } from 'vitest'

import type { FieldError } from './problem.filter'
import {
  createValidationPipe,
  EachItem,
  type ItemRule,
  RootRule,
  type RootRuleOptions,
} from './validation.pipe'

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

/** Regla de prueba de raíz: al menos uno de `status` o `featured` (como `adminReviewUpdateSchema`). */
const AT_LEAST_ONE: RootRuleOptions = {
  name: 'testAtLeastOneChange',
  code: 'empty_update',
  message: 'Mandá al menos un cambio',
  isValid: (value) => Object.values(value).some((item) => item !== undefined),
}

@RootRule(AT_LEAST_ONE)
class PatchDto {
  @IsOptional()
  @IsIn(['pending', 'approved'], { message: 'Elegí un estado' })
  status?: string

  @IsOptional()
  @IsBoolean({ message: 'Sí o no' })
  featured?: boolean
}

class PatchParentDto {
  @ValidateNested()
  @Type(() => PatchDto)
  patch!: PatchDto
}

describe('createValidationPipe con RootRule (errores de raíz, Ruling B-80)', () => {
  it('sin ningún campo da el error de raíz con field vacío y el código de la regla', async () => {
    await expect(errorsOf(PatchDto, {})).resolves.toEqual([
      { field: '', code: 'empty_update', message: 'Mandá al menos un cambio' },
    ])
  })

  it('con un campo válido no hay errores', async () => {
    await expect(errorsOf(PatchDto, { featured: false })).resolves.toEqual([])
    await expect(errorsOf(PatchDto, { status: 'approved', featured: true })).resolves.toEqual([])
  })

  it('el error de un campo sale solo y sin el de raíz cuando la regla se cumple', async () => {
    await expect(errorsOf(PatchDto, { status: 'deleted' })).resolves.toEqual([
      { field: 'status', code: 'invalid_value', message: 'Elegí un estado' },
    ])
  })

  it('la clave vacía no queda permitida: un campo "" responde que no está permitido', async () => {
    const errors = await errorsOf(PatchDto, { '': 1, featured: true })

    expect(errors).toEqual([
      { field: '', code: 'unrecognized_key', message: 'Este campo no está permitido.' },
    ])
  })

  it('en un objeto anidado el error va en la ruta del objeto', async () => {
    await expect(errorsOf(PatchParentDto, { patch: {} })).resolves.toEqual([
      { field: 'patch', code: 'empty_update', message: 'Mandá al menos un cambio' },
    ])
  })

  it('los DTOs sin RootRule no cambian: un cuerpo vacío no suma errores de raíz', async () => {
    const errors = await errorsOf(ListDto, {})

    expect(errors.some((error) => error.field === '')).toBe(false)
    expect(errors.map((error) => error.field)).toEqual(['ids', 'ids', 'count'])
  })

  it('RootRule rechaza una regla sin nombre, código o mensaje', () => {
    expect(() => RootRule({ ...AT_LEAST_ONE, name: '' })).toThrow(TypeError)
    expect(() => RootRule({ ...AT_LEAST_ONE, code: ' ' })).toThrow(TypeError)
    expect(() => RootRule({ ...AT_LEAST_ONE, message: '' })).toThrow(TypeError)
  })
})
