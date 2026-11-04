import { Prisma } from '../../../generated/prisma/client'

/** Letras con acento que la búsqueda iguala a su letra base (`translate` de Postgres). */
export const SEARCH_ACCENTED = 'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç'

/**
 * Cada letra de {@link SEARCH_ACCENTED} sin acento y en minúscula, en el mismo orden (lo que da
 * `normalizeSearchText` del catálogo letra por letra; va literal para que `shared` no dependa de
 * ningún módulo).
 */
export const SEARCH_UNACCENTED = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'

/**
 * Texto donde se busca, normalizado en SQL igual que `normalizeSearchText` (sin acentos, en
 * minúsculas y con los espacios colapsados): se compara con `strpos(<esto>, <q normalizada>) > 0`.
 * Postgres no guarda NUL en un `text`, así que una `q` con NUL no coincide con nada (lo resuelve
 * quien arma la consulta).
 *
 * @param expression - Expresión SQL de texto, por ejemplo `p.name || ' ' || p.description`.
 * @returns `regexp_replace(lower(translate(expression, acentuadas, sin acento)), '\s+', ' ', 'g')`.
 */
export function searchableTextSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`regexp_replace(lower(translate(${expression}, ${SEARCH_ACCENTED}, ${SEARCH_UNACCENTED})), ${'\\s+'}, ' ', 'g')`
}
