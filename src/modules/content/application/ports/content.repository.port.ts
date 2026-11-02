import type { ContentKey } from '../../domain/content-key'

/** Lecturas de los contenidos editables. */
export interface ContentRepository {
  /**
   * Busca el contenido de una clave.
   *
   * @param key - Clave del contenido.
   * @returns El JSON guardado, o `null` si la clave no está cargada.
   */
  find(key: ContentKey): Promise<unknown>
}

/** Token de inyección del {@link ContentRepository}. */
export const CONTENT_REPOSITORY = Symbol('CONTENT_REPOSITORY')
