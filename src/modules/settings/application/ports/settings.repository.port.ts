import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { ShippingOption, StoreSettings } from '../../domain/store-settings.entity'

/** Opción de envío como la guarda el dashboard: sin `label`, que es fijo por método. */
export type ShippingOptionChanges = Omit<ShippingOption, 'label'>

/** Ajustes completos que guarda el dashboard, con los envíos en el orden `home`, `branch`, `pickup`. */
export interface SettingsChanges extends Omit<StoreSettings, 'shippingOptions'> {
  /** Las tres opciones de envío, una por método y en orden. */
  shippingOptions: ShippingOptionChanges[]
}

/** Quién guarda los ajustes y qué evento va en la misma transacción. */
export interface SettingsWrite {
  /** Usuario admin que los guarda (`settings.updated_by`). */
  updatedBy: string
  /** Aviso a la tienda (`storefront.stale`), en la transacción del guardado. */
  event: NewDomainEvent
}

/** Lectura y escritura de los ajustes de la tienda. */
export interface SettingsRepository {
  /**
   * Lee los ajustes (fila única) con las opciones de envío.
   *
   * @throws {Error} En español, si los ajustes no están cargados (falta correr el seed).
   */
  get(): Promise<StoreSettings>

  /**
   * Reemplaza los ajustes (fila única): suma 1 a `version`, guarda quién los editó, actualiza el
   * costo, el plazo y si está habilitada cada opción de envío (sin tocar su `label`; una que falte
   * se crea con el nombre de fábrica) y agrega `write.event` al outbox, todo en una transacción.
   * La caché se borra después del commit.
   *
   * @param changes - Ajustes completos, ya validados y normalizados.
   * @param write - Usuario admin y evento del guardado.
   * @returns Los ajustes guardados, releídos (con el `label` de cada envío).
   * @throws {Error} En español, si los ajustes no están cargados (falta correr el seed).
   */
  save(changes: SettingsChanges, write: SettingsWrite): Promise<StoreSettings>
}

/** Token de inyección del {@link SettingsRepository}. */
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY')
