import type { StoreSettings } from '../../domain/store-settings.entity'

/** Lectura de los ajustes de la tienda. */
export interface SettingsRepository {
  /**
   * Lee los ajustes (fila única) con las opciones de envío.
   *
   * @throws {Error} En español, si los ajustes no están cargados (falta correr el seed).
   */
  get(): Promise<StoreSettings>
}

/** Token de inyección del {@link SettingsRepository}. */
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY')
