import type { StoreSettings } from '../../domain/store-settings.entity'
import type { SettingsRepository } from '../ports/settings.repository.port'

/**
 * Ajustes completos de la tienda, para otros módulos (por ejemplo la alícuota de IVA del
 * catálogo). No se expone por HTTP: lo público es {@link GetPublicSettingsQuery}.
 */
export class GetStoreSettingsQuery {
  /** @param settings - Lectura de los ajustes. */
  constructor(private readonly settings: SettingsRepository) {}

  /**
   * Devuelve los ajustes completos.
   *
   * @returns Los ajustes, con IVA y umbral de stock bajo.
   */
  execute(): Promise<StoreSettings> {
    return this.settings.get()
  }
}
