import type { SettingsRepository } from '../ports/settings.repository.port'
import { type AdminSettings, toAdminSettings } from '../read-models'

/**
 * Ajustes del dashboard (`GET /admin/settings`): cableada a Postgres sin caché (Ruling B-79), así
 * el dashboard nunca ve un valor viejo.
 */
export class GetAdminSettingsQuery {
  /** @param settings - Lectura de los ajustes (sin caché). */
  constructor(private readonly settings: Pick<SettingsRepository, 'get'>) {}

  /**
   * Devuelve los ajustes públicos más el umbral de poco stock y el IVA.
   *
   * @returns Los ajustes con la forma `AdminSettings` del contrato.
   */
  async execute(): Promise<AdminSettings> {
    return toAdminSettings(await this.settings.get())
  }
}
