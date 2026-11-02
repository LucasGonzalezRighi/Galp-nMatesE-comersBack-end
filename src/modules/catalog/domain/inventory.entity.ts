/** Máximo de unidades de un mismo producto que se pueden comprar (como el front). */
export const MAX_QUANTITY_PER_PRODUCT = 20

/** Stock de un producto: unidades en depósito y reservadas por pedidos pendientes. */
export interface InventoryProps {
  /** Unidades en el depósito. */
  onHand: number
  /** Unidades reservadas (0 a `onHand`). */
  reserved: number
}

/** Stock de un producto; lo disponible es `onHand - reserved`. */
export class Inventory {
  private constructor(private readonly props: InventoryProps) {}

  /**
   * Crea el stock validado.
   *
   * @param props - Unidades en depósito y reservadas.
   * @returns El stock.
   * @throws {RangeError} En español, si no son enteros desde 0 o lo reservado supera lo que hay.
   */
  static create(props: InventoryProps): Inventory {
    if (!Number.isSafeInteger(props.onHand) || props.onHand < 0) {
      throw new RangeError(
        `Las unidades en depósito tienen que ser un entero desde 0; se recibió ${String(props.onHand)}.`,
      )
    }
    if (!Number.isSafeInteger(props.reserved) || props.reserved < 0) {
      throw new RangeError(
        `Las unidades reservadas tienen que ser un entero desde 0; se recibió ${String(props.reserved)}.`,
      )
    }
    if (props.reserved > props.onHand) {
      throw new RangeError(
        `Lo reservado (${String(props.reserved)}) no puede superar lo que hay en depósito (${String(props.onHand)}).`,
      )
    }
    return new Inventory({ onHand: props.onHand, reserved: props.reserved })
  }

  /** Unidades que se pueden vender ahora. */
  available(): number {
    return this.props.onHand - this.props.reserved
  }

  /** Máximo que se puede comprar: lo disponible, con tope {@link MAX_QUANTITY_PER_PRODUCT}. */
  maxQuantity(): number {
    return Math.min(MAX_QUANTITY_PER_PRODUCT, this.available())
  }

  /** Datos planos del stock (para la caché). */
  toProps(): InventoryProps {
    return { ...this.props }
  }
}
