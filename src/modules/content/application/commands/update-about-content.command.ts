import { storefrontStaleEvent } from '../../../../shared/domain/storefront-tags'
import { type MediaImage, resolveImage } from '../../../media/domain/media'
import { ContentValidationError } from '../../domain/content-errors'
import { CONTENT_UPDATED_REASON, contentStorefrontTags } from '../../domain/content-key'
import type { ContentRepository } from '../ports/content.repository.port'
import type { AboutContent } from '../read-models'
import { assertAdminUserId, toContentJson } from './update-content.command'

/** Foto de un socio como la manda el dashboard (`ImageInput`): sin `url`. */
export type PartnerPhotoInput = Omit<MediaImage, 'url'>

/** Nosotros como lo manda el dashboard (`AboutContentInput`): la foto de cada socio sin `url`. */
export interface AboutContentInput extends Omit<AboutContent, 'partners'> {
  /** Socios, con su foto ya subida o `null`. */
  partners: { name: string; role: string; photo: PartnerPhotoInput | null }[]
}

/** Indica si un valor es un objeto JSON (no una lista). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fotos de los socios que Nosotros ya tiene guardadas: las que vuelven conservan su `url`.
 *
 * @param about - Nosotros guardado (o `null` si no está cargado).
 * @returns Las fotos con `publicId` y `url` de texto; lo demás se ignora.
 */
function storedPhotos(about: unknown): MediaImage[] {
  if (!isObject(about) || !Array.isArray(about.partners)) return []
  return about.partners.flatMap((partner: unknown) => {
    const photo = isObject(partner) ? partner.photo : null
    return isObject(photo) && typeof photo.publicId === 'string' && typeof photo.url === 'string'
      ? [photo as unknown as MediaImage]
      : []
  })
}

/** Guardado de Nosotros desde el dashboard (`PUT /admin/content/about`). */
export class UpdateAboutContentCommand {
  /**
   * @param contents - Contenidos guardados (lee las fotos actuales y guarda).
   * @param cloudName - Nube de Cloudinary con la que se arma la `url` de una foto nueva.
   * @throws {TypeError} En español, si la nube está vacía.
   */
  constructor(
    private readonly contents: Pick<ContentRepository, 'find' | 'save'>,
    private readonly cloudName: string,
  ) {
    if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de las fotos.')
  }

  /**
   * Resuelve la foto de cada socio (la que ya estaba conserva su `url`; una nueva tiene que estar
   * en `galpon/socios/`) y guarda Nosotros con su aviso a la tienda (`storefront.stale`,
   * `content.updated`, `content:about`) en la misma transacción. Corta en la primera foto que no
   * conoce, como el mock.
   *
   * @param input - Nosotros completo, ya validado y normalizado por el pipe.
   * @param adminUserId - Usuario admin que lo guarda.
   * @returns Nosotros guardado, con las fotos armadas (`AboutContent`).
   * @throws {ContentValidationError} 422 `unknown_image` en `partners.N.photo.publicId`.
   * @throws {TypeError} En español, si falta el usuario.
   */
  async execute(input: AboutContentInput, adminUserId: string): Promise<AboutContent> {
    assertAdminUserId(adminUserId)
    const stored = storedPhotos(await this.contents.find('about'))
    const partners: AboutContent['partners'] = []
    for (const [index, { name, role, photo }] of input.partners.entries()) {
      if (photo === null) {
        partners.push({ name, role, photo: null })
        continue
      }
      const resolved = resolveImage(photo, {
        purpose: 'partner',
        stored,
        cloudName: this.cloudName,
        field: `partners.${String(index)}.photo`,
      })
      if (!resolved.ok) throw new ContentValidationError([resolved.error])
      partners.push({ name, role, photo: resolved.image })
    }
    const data = toContentJson({ ...input, partners })
    await this.contents.save('about', data, {
      updatedBy: adminUserId,
      event: storefrontStaleEvent(CONTENT_UPDATED_REASON, contentStorefrontTags('about')),
    })
    return data as unknown as AboutContent
  }
}
