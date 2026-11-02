import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, Max, Min } from 'class-validator'

/** Primera página de las listas (parámetro `Page` del contrato). */
export const FIRST_PAGE = 1

/** Tamaño de página por defecto de las listas (parámetro `PageSize` del contrato). */
export const DEFAULT_PAGE_SIZE = 24

/** Tamaño de página máximo de las listas. */
export const MAX_PAGE_SIZE = 100

/**
 * Query de paginación (`page` y `pageSize` del contrato). Con el pipe global, `?pageSize=1000`
 * o `?page=0` responden 422 con un error por campo.
 */
export class PageQueryDto {
  /** Número de página, desde 1. */
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: FIRST_PAGE,
    description: 'Número de página, empezando en 1.',
  })
  @IsInt({ message: 'La página tiene que ser un número entero.' })
  @Min(1, { message: 'La página tiene que ser mayor o igual a 1.' })
  page: number = FIRST_PAGE

  /** Elementos por página, de 1 a {@link MAX_PAGE_SIZE}. */
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Cantidad de elementos por página (de 1 a 100).',
  })
  @IsInt({ message: 'El tamaño de página tiene que ser un número entero.' })
  @Min(1, { message: 'El tamaño de página tiene que ser mayor o igual a 1.' })
  @Max(MAX_PAGE_SIZE, { message: 'El tamaño de página tiene que ser menor o igual a 100.' })
  pageSize: number = DEFAULT_PAGE_SIZE
}
