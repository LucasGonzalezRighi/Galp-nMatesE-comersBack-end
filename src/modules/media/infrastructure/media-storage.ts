import type { Env } from '../../../config/env'
import { mediaCloudName } from '../../../config/media'
import type { Prisma } from '../../../generated/prisma/client'
import type { MediaImage } from '../domain/media'
import type { MediaProvider, MediaStorage } from '../application/ports/media-storage.port'

/**
 * Arma la {@link MediaStorage} de la app según `MEDIA_MODE` (Ruling B-74).
 *
 * @param env - Modo de las fotos y la nube configurada.
 * @returns El proveedor de las fotos nuevas y la nube de sus `url`.
 * @throws {Error} En español, si el modo es `cloudinary` y falta la nube.
 */
export function createMediaStorage(
  env: Pick<Env, 'MEDIA_MODE' | 'CLOUDINARY_CLOUD_NAME'>,
): MediaStorage {
  return { provider: env.MEDIA_MODE, cloudName: mediaCloudName(env) }
}

/**
 * Busca o crea en `media_assets` cada foto, por su `publicId` (es único). Una foto que ya estaba
 * conserva su proveedor y su `url` y toma las medidas del cuerpo; una nueva se crea con el
 * proveedor de `MEDIA_MODE`, la `url` resuelta y su `alt` (el de la primera vez: el de cada uso se
 * guarda en `product_images.alt` o `categories.image_alt`). Usa el `upsert` nativo de Postgres
 * (`ON CONFLICT`), así que la misma foto repetida en un producto o guardada a la vez desde dos
 * recursos nunca da un `P2002`.
 *
 * @param tx - Transacción de la escritura.
 * @param images - Fotos ya resueltas (pueden repetirse).
 * @param provider - Proveedor de las fotos nuevas.
 * @returns El id de cada foto, por `publicId`.
 */
export async function saveMediaAssets(
  tx: Prisma.TransactionClient,
  images: readonly MediaImage[],
  provider: MediaProvider,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const { publicId, url, width, height, alt } of images) {
    if (ids.has(publicId)) continue
    const asset = await tx.mediaAsset.upsert({
      where: { publicId },
      create: { provider, publicId, url, width, height, alt },
      update: { width, height },
      select: { id: true },
    })
    ids.set(publicId, asset.id)
  }
  return ids
}
