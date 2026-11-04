import type { JsonObject, NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { ContentKey } from '../../domain/content-key'

/** Quién guarda un contenido y qué evento va en la misma transacción. */
export interface ContentWrite {
  /** Usuario admin que lo guarda (`content_blocks.updated_by`). */
  updatedBy: string
  /** Aviso a la tienda (`storefront.stale`), en la transacción del guardado. */
  event: NewDomainEvent
}

/** Lecturas y escrituras de los contenidos editables. */
export interface ContentRepository {
  /**
   * Busca el contenido de una clave.
   *
   * @param key - Clave del contenido.
   * @returns El JSON guardado, o `null` si la clave no está cargada.
   */
  find(key: ContentKey): Promise<unknown>

  /**
   * Reemplaza el contenido de una clave (o lo crea): suma 1 a `version`, guarda quién lo editó y
   * agrega `write.event` al outbox, todo en una transacción. La caché se borra después del commit.
   *
   * @param key - Clave del contenido.
   * @param data - Contenido completo, ya normalizado.
   * @param write - Usuario admin y evento del guardado.
   */
  save(key: ContentKey, data: JsonObject, write: ContentWrite): Promise<void>
}

/** Token de inyección del {@link ContentRepository}. */
export const CONTENT_REPOSITORY = Symbol('CONTENT_REPOSITORY')
