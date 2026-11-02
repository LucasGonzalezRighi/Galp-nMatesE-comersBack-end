import { type ContentKey, isContentKey } from '../../domain/content-key'
import type { ContentRepository } from '../ports/content.repository.port'
import type { ContentByKey } from '../read-models'

/** Contenido editable por clave (`home`, `faq`, `product-tabs`, `legal-terms`…). */
export class GetContentQuery {
  /** @param contents - Lecturas de contenidos. */
  constructor(private readonly contents: ContentRepository) {}

  /**
   * Devuelve el contenido de una clave con su forma del contrato.
   *
   * La forma la garantiza quien lo escribe (el seed y, desde B5, el admin con sus schemas): acá
   * solo se comprueba que sea un objeto JSON.
   *
   * @param key - Clave del contenido.
   * @returns El contenido, o `null` si la clave no está cargada.
   * @throws {RangeError} En español, si `key` no es una clave de contenido.
   * @throws {TypeError} En español, si lo guardado no es un objeto JSON.
   */
  async execute<K extends ContentKey>(key: K): Promise<ContentByKey[K] | null> {
    if (!isContentKey(key)) {
      throw new RangeError(`"${String(key)}" no es una clave de contenido.`)
    }
    const data = await this.contents.find(key)
    if (data === null || data === undefined) return null
    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError(`El contenido "${key}" está dañado: no es un objeto JSON.`)
    }
    return data as ContentByKey[K]
  }
}
