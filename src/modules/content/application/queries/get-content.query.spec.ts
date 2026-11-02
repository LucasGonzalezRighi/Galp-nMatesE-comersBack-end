import { describe, expect, it } from 'vitest'

import type { ContentKey } from '../../domain/content-key'
import { legalContentKey } from '../../domain/content-key'
import type { ContentRepository } from '../ports/content.repository.port'
import { GetContentQuery } from './get-content.query'

/** Repositorio en memoria con los bloques dados. */
function repository(blocks: Partial<Record<ContentKey, unknown>>): ContentRepository {
  return { find: (key) => Promise.resolve(blocks[key] ?? null) }
}

describe('GetContentQuery', () => {
  it('devuelve el contenido guardado con su clave', async () => {
    const footer = {
      tagline: 'Mates',
      text: 'Hechos a mano.',
      paymentMethods: [],
      consumerDefenseUrl: null,
    }
    const query = new GetContentQuery(repository({ footer }))
    await expect(query.execute('footer')).resolves.toEqual(footer)
  })

  it('devuelve null si el contenido no está cargado', async () => {
    await expect(new GetContentQuery(repository({})).execute('home')).resolves.toBeNull()
  })

  it('rechaza una clave desconocida y un contenido que no es un objeto', async () => {
    const query = new GetContentQuery(repository({ faq: ['roto'] }))
    await expect(query.execute('otra' as ContentKey)).rejects.toThrow(/clave de contenido/)
    await expect(query.execute('faq')).rejects.toThrow(/dañado/)
  })

  it('mapea los documentos legales del contrato a su clave', () => {
    expect(legalContentKey('terms')).toBe('legal-terms')
    expect(legalContentKey('privacy')).toBe('legal-privacy')
    expect(() => legalContentKey('otro' as 'terms')).toThrow(/documento legal/)
  })
})
