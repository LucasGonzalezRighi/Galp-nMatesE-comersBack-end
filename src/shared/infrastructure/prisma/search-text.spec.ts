import { describe, expect, it } from 'vitest'

import { Prisma } from '../../../generated/prisma/client'
import { SEARCH_ACCENTED, SEARCH_UNACCENTED, searchableTextSql } from './search-text'

describe('searchableTextSql', () => {
  it('las letras sin acento son las de normalizar cada acentuada (NFD, sin marcas, minúscula)', () => {
    const expected = Array.from(SEARCH_ACCENTED)
      .map((letter) =>
        letter
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase(),
      )
      .join('')

    expect(SEARCH_UNACCENTED).toBe(expected)
    expect(Array.from(SEARCH_UNACCENTED)).toHaveLength(Array.from(SEARCH_ACCENTED).length)
  })

  it('envuelve la expresión con translate, lower y regexp_replace, con los textos como parámetros', () => {
    const sql = searchableTextSql(Prisma.sql`o.number || ' ' || o.contact_email::text`)

    expect(sql.sql).toBe(
      "regexp_replace(lower(translate(o.number || ' ' || o.contact_email::text, ?, ?)), ?, ' ', 'g')",
    )
    expect(sql.values).toEqual([SEARCH_ACCENTED, SEARCH_UNACCENTED, '\\s+'])
  })
})
