import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { ComboRecord, ComboStatus } from '../../domain/combo.entity'
import type { Product } from '../../domain/product.entity'

/**
 * Datos editables de un combo, como los carga el dashboard (`ComboInput` del contrato) y ya
 * normalizados: textos recortados, de 2 a 3 productos sin repetir y un precio entero.
 */
export interface ComboFields {
  /** Nombre visible (de 3 a 80 caracteres). */
  name: string
  /** Descripción corta (hasta 300 caracteres; puede ser vacía). */
  description: string
  /** Ids de los productos, en el orden del combo (de 2 a 3). */
  productIds: string[]
  /** Precio final del combo, en pesos enteros (de 1 a 99.999.999). */
  priceArs: number
  /** Borrador o publicado. */
  status: ComboStatus
}

/**
 * Combo guardado con sus piezas vigentes: los productos en cualquier estado (borradores,
 * archivados o "a consultar" incluidos), en el orden del combo.
 */
export interface StoredCombo {
  /** El combo como está guardado. */
  combo: ComboRecord
  /** Sus productos, en el orden de `combo.productIds`. */
  pieces: Product[]
}

/**
 * Combos del catálogo (tablas `combos` y `combo_items`). Las lecturas no pasan por la caché: los
 * datos derivados dependen del stock y de los precios vigentes de las piezas. Cada escritura
 * guarda su evento `combo.changed` en el outbox en la misma transacción, y una escritura que no
 * encuentra el combo no lo guarda. Un id que no es un UUID es un combo que no existe.
 */
export interface ComboRepository {
  /**
   * Lista todos los combos, borradores incluidos, por `position` y después por fecha de alta.
   *
   * @returns Los combos con sus piezas.
   */
  list(): Promise<StoredCombo[]>

  /**
   * Busca un combo por id.
   *
   * @param id - Id pedido (puede no ser un UUID).
   * @returns El combo con sus piezas, o `null` si no existe.
   */
  findById(id: string): Promise<StoredCombo | null>

  /**
   * Busca productos por id, en cualquier estado.
   *
   * @param ids - Ids pedidos (los que no son UUID se ignoran).
   * @returns Los productos que existen, en cualquier orden.
   */
  findProducts(ids: readonly string[]): Promise<Product[]>

  /**
   * Lista los ids de todos los combos, en el orden de {@link list}.
   *
   * @returns Los ids.
   */
  listIds(): Promise<string[]>

  /**
   * Crea un combo al final del listado (`position` = la mayor + 1, o 1 si no hay ninguno).
   *
   * @param id - Id nuevo (UUID v7).
   * @param fields - Datos ya validados.
   * @param event - Evento `combo.changed` para el outbox.
   * @returns El combo creado con sus piezas.
   */
  create(id: string, fields: ComboFields, event: NewDomainEvent): Promise<StoredCombo>

  /**
   * Reemplaza los datos y las piezas de un combo; conserva su `position`.
   *
   * @param id - Id del combo.
   * @param fields - Datos ya validados.
   * @param event - Evento `combo.changed` para el outbox (solo se guarda si el combo existe).
   * @returns El combo modificado, o `null` si no existe.
   */
  update(id: string, fields: ComboFields, event: NewDomainEvent): Promise<StoredCombo | null>

  /**
   * Borra un combo y renumera los demás de 1 en adelante, sin huecos.
   *
   * @param id - Id del combo.
   * @param event - Evento `combo.changed` para el outbox (solo se guarda si el combo existía).
   * @returns `true` si lo borró; `false` si no existía.
   */
  delete(id: string, event: NewDomainEvent): Promise<boolean>

  /**
   * Fija el orden de los combos: `position` pasa a ser el lugar de cada id, desde 1.
   *
   * @param ids - Todos los combos, una vez cada uno (ya verificado), en el orden nuevo.
   * @param event - Evento `combo.changed` para el outbox.
   */
  reorder(ids: readonly string[], event: NewDomainEvent): Promise<void>
}

/** Token de inyección del {@link ComboRepository}. */
export const COMBO_REPOSITORY = Symbol('COMBO_REPOSITORY')
