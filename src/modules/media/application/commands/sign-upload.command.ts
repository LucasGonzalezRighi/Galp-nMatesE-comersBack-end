import type { Clock } from '../../../../shared/domain/clock'
import { isMediaPurpose, MEDIA_FOLDERS, type MediaPurpose } from '../../domain/media'
import type { UploadSignature, UploadSigner } from '../ports/upload-signer.port'

/** Firma de una subida de foto desde el dashboard (`POST /admin/media/signature`). */
export class SignUploadCommand {
  /**
   * @param signer - Firmante (Cloudinary o simulado, según `MEDIA_MODE`).
   * @param clock - Reloj (el `timestamp` de la firma).
   */
  constructor(
    private readonly signer: UploadSigner,
    private readonly clock: Clock,
  ) {}

  /**
   * Firma una subida a la carpeta del uso, con la hora actual en segundos.
   *
   * @param purpose - Para qué es la foto (`product` → `galpon/productos`…).
   * @returns Los datos firmados (`MediaSignature`).
   * @throws {RangeError} En español, si el uso no es uno de `MEDIA_PURPOSES`.
   */
  execute(purpose: MediaPurpose): UploadSignature {
    if (!isMediaPurpose(purpose)) {
      throw new RangeError(`"${String(purpose)}" no es un uso de foto.`)
    }
    const timestamp = Math.floor(this.clock.now().getTime() / 1000)
    return this.signer.sign(MEDIA_FOLDERS[purpose], timestamp)
  }
}
