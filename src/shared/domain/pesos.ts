/**
 * Monto en pesos argentinos enteros (los `*_ars` del contrato): value object inmutable.
 *
 * Nunca tiene decimales ni es negativo; las operaciones devuelven un `Pesos` nuevo. En los
 * descuentos se redondea el ahorro al peso más cercano y el total es el monto menos ese ahorro.
 *
 * @example
 * Pesos.of(1999).percentOff(15).toNumber() // 1699
 */
export class Pesos {
  private constructor(private readonly amount: number) {}

  /**
   * Crea un monto.
   *
   * @param amount - Pesos enteros, de 0 en adelante.
   * @returns El monto.
   * @throws {RangeError} En español, si `amount` tiene decimales, no es un número seguro o es
   *   negativo.
   */
  static of(amount: number): Pesos {
    if (!Number.isSafeInteger(amount)) {
      throw new RangeError(`Un monto en pesos tiene que ser un entero (llegó ${String(amount)})`)
    }
    if (amount < 0) {
      throw new RangeError(`Un monto en pesos no puede ser negativo (llegó ${String(amount)})`)
    }
    return new Pesos(amount)
  }

  /**
   * Suma otro monto.
   *
   * @param other - El monto a sumar.
   * @returns La suma.
   */
  add(other: Pesos): Pesos {
    return Pesos.of(this.amount + other.amount)
  }

  /**
   * Multiplica por una cantidad (por ejemplo, precio unitario por unidades).
   *
   * @param factor - Entero de 0 en adelante.
   * @returns El producto.
   * @throws {RangeError} En español, si `factor` no es un entero no negativo.
   */
  multiply(factor: number): Pesos {
    if (!Number.isSafeInteger(factor) || factor < 0) {
      throw new RangeError(
        `Solo se puede multiplicar un monto por un entero no negativo (llegó ${String(factor)})`,
      )
    }
    return Pesos.of(this.amount * factor)
  }

  /**
   * Calcula el ahorro de un descuento porcentual, redondeado al peso más cercano.
   *
   * Es la misma cuenta que hace el front (`Math.round(total * porcentaje / 100)`): se redondea el
   * ahorro, no el total. Así el carrito y el pedido coinciden al peso.
   *
   * @param percent - Porcentaje de descuento, de 0 a 100.
   * @returns El monto que se ahorra.
   * @throws {RangeError} En español, si `percent` no es un número entre 0 y 100.
   */
  percentOf(percent: number): Pesos {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new RangeError(
        `El porcentaje de descuento tiene que estar entre 0 y 100 (llegó ${String(percent)})`,
      )
    }
    return Pesos.of(Math.round((this.amount * percent) / 100))
  }

  /**
   * Aplica un descuento porcentual: el monto menos su ahorro ({@link Pesos.percentOf}).
   *
   * @param percent - Porcentaje de descuento, de 0 a 100.
   * @returns El monto con el descuento aplicado.
   * @throws {RangeError} En español, si `percent` no es un número entre 0 y 100.
   */
  percentOff(percent: number): Pesos {
    return Pesos.of(this.amount - this.percentOf(percent).amount)
  }

  /**
   * Indica si dos montos son iguales.
   *
   * @param other - El otro monto.
   * @returns `true` si valen lo mismo.
   */
  equals(other: Pesos): boolean {
    return this.amount === other.amount
  }

  /** @returns El monto como número entero, para guardarlo o devolverlo en un `*_ars`. */
  toNumber(): number {
    return this.amount
  }
}
