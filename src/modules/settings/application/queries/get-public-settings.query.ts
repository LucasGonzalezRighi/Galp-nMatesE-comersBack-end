import type { SettingsRepository } from '../ports/settings.repository.port'
import { type PublicSettings, toPublicSettings } from '../read-models'

/** Ajustes públicos de la tienda (`GET /settings/public`). */
export class GetPublicSettingsQuery {
  /** @param settings - Lectura de los ajustes. */
  constructor(private readonly settings: Pick<SettingsRepository, 'get'>) {}

  /**
   * Devuelve solo lo que la tienda puede mostrar.
   *
   * @returns Los ajustes públicos, sin la alícuota de IVA ni el umbral de stock bajo.
   */
  async execute(): Promise<PublicSettings> {
    return toPublicSettings(await this.settings.get())
  }
}
