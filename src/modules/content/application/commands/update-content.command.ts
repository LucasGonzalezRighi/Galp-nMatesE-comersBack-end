import type { JsonObject } from '../../../../shared/domain/domain-event'
import { storefrontStaleEvent } from '../../../../shared/domain/storefront-tags'
import {
  CONTENT_UPDATED_REASON,
  type ContentKey,
  contentStorefrontTags,
  isContentKey,
} from '../../domain/content-key'
import type { ContentRepository } from '../ports/content.repository.port'
import type { ContentByKey } from '../read-models'

/** Contenidos que se guardan tal como llegan: todos menos Nosotros, que resuelve sus fotos. */
export type PlainContentKey = Exclude<ContentKey, 'about'>

/**
 * Copia un contenido ya validado a JSON plano (sin las clases de los DTOs).
 *
 * @param content - Contenido completo.
 * @returns El objeto JSON que se guarda.
 * @throws {TypeError} En español, si no es un objeto (una lista o un valor suelto).
 */
export function toContentJson(content: unknown): JsonObject {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw new TypeError('Un contenido tiene que ser un objeto JSON.')
  }
  return structuredClone(content) as JsonObject
}

/**
 * Revisa el usuario admin que guarda un contenido.
 *
 * @param adminUserId - Id del usuario de la sesión de admin.
 * @throws {TypeError} En español, si está vacío.
 */
export function assertAdminUserId(adminUserId: string): void {
  if (adminUserId.trim() === '') {
    throw new TypeError('Falta el usuario admin que guarda el contenido.')
  }
}

/**
 * Guardado de un contenido del dashboard (`PUT /admin/content/{home,faq,footer,product-tabs}` y
 * `PUT /admin/content/legal/{document}`).
 */
export class UpdateContentCommand {
  /** @param contents - Contenidos guardados (la escritura borra su caché después del commit). */
  constructor(private readonly contents: Pick<ContentRepository, 'save'>) {}

  /**
   * Reemplaza el contenido de una clave con su aviso a la tienda (`storefront.stale`,
   * `content.updated`, con las etiquetas de {@link contentStorefrontTags}) en la misma transacción.
   *
   * @param key - Clave del contenido (no `about`).
   * @param content - Contenido completo, ya validado y normalizado por el pipe.
   * @param adminUserId - Usuario admin que lo guarda.
   * @returns El contenido guardado.
   * @throws {RangeError} En español, si la clave no es un contenido o es `about`.
   * @throws {TypeError} En español, si el contenido no es un objeto o falta el usuario.
   */
  async execute<K extends PlainContentKey>(
    key: K,
    content: ContentByKey[K],
    adminUserId: string,
  ): Promise<ContentByKey[K]> {
    if (!isContentKey(key) || (key as ContentKey) === 'about') {
      throw new RangeError(`"${key}" no es un contenido que se guarde tal cual.`)
    }
    assertAdminUserId(adminUserId)
    const data = toContentJson(content)
    await this.contents.save(key, data, {
      updatedBy: adminUserId,
      event: storefrontStaleEvent(CONTENT_UPDATED_REASON, contentStorefrontTags(key)),
    })
    return data as unknown as ContentByKey[K]
  }
}
