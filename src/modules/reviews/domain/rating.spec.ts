import { describe, expect, it } from 'vitest'

import { averageRating, isValidRating, ratingDistribution, summarizeRatings } from './rating'

describe('puntuaciones de reseñas', () => {
  it('acepta medias estrellas de 1 a 5 y rechaza el resto', () => {
    expect([1, 1.5, 4.5, 5].every(isValidRating)).toBe(true)
    expect([0, 0.5, 4.3, 5.5, Number.NaN].some(isValidRating)).toBe(false)
  })

  it('promedia sin redondear y da 0 sin reseñas', () => {
    expect(averageRating([5, 5, 4])).toBe(14 / 3)
    expect(averageRating([])).toBe(0)
  })

  it('cuenta una media estrella en la fila de su parte entera, de 5 a 1', () => {
    expect(ratingDistribution([5, 4.5, 4, 1])).toEqual([
      { stars: 5, count: 1, percent: 25 },
      { stars: 4, count: 2, percent: 50 },
      { stars: 3, count: 0, percent: 0 },
      { stars: 2, count: 0, percent: 0 },
      { stars: 1, count: 1, percent: 25 },
    ])
    expect(ratingDistribution([]).every((row) => row.count === 0 && row.percent === 0)).toBe(true)
  })

  it('resume promedio y cantidad', () => {
    expect(summarizeRatings([5, 5, 4])).toEqual({ average: 14 / 3, count: 3 })
    expect(summarizeRatings([])).toEqual({ average: 0, count: 0 })
  })

  it('lanza RangeError en español con una puntuación inválida', () => {
    expect(() => averageRating([4.3])).toThrow(/La puntuación tiene que ser/)
    expect(() => ratingDistribution([6])).toThrow(RangeError)
  })
})
