import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type request from 'supertest'
import { expect } from 'vitest'

import type {
  CartQuote,
  CreateOrderResultView,
} from '../../src/modules/orders/application/read-models'
import { call, type Jar, newJar } from './http'

/** Línea del carrito como la manda la tienda. */
export type CartLine = Record<string, unknown>

/** Cuero de un mate (`CartItemOptions`). */
export const MATE_OPTIONS = { leather: 'Negro' }

/** Dirección de domicilio completa (el envío a domicilio cuesta 6500 en el seed). */
export const HOME_ADDRESS = {
  street: 'Av. Corrientes',
  number: '1234',
  apartment: null,
  postalCode: 'C1043',
  city: 'CABA',
  province: 'CABA',
}

/** Costo del envío a domicilio en el seed. */
export const HOME_SHIPPING_ARS = 6500

/** Cuerpo de `POST /orders` con el total que cotiza el back. */
export type OrderBody = Record<string, unknown> & { expectedTotalArs: number }

/**
 * Línea de un producto suelto (un mate lleva cuero y virola; los demás las ignoran).
 *
 * @param id - Id del producto.
 * @param quantity - Unidades (por defecto 1).
 * @returns La línea del carrito.
 */
export function mateLine(id: string, quantity = 1): CartLine {
  return { type: 'product', productId: id, quantity, options: MATE_OPTIONS }
}

/**
 * Línea de un combo (si el combo no lleva mate, el back ignora las opciones).
 *
 * @param id - Id del combo.
 * @param quantity - Cantidad de combos (por defecto 1).
 * @param options - Cuero del mate (por defecto {@link MATE_OPTIONS}).
 * @returns La línea del carrito.
 */
export function comboLine(
  id: string,
  quantity = 1,
  options: Readonly<Record<string, string>> | null = MATE_OPTIONS,
): CartLine {
  return { type: 'combo', comboId: id, quantity, options }
}

/**
 * Los pasos de la tienda para crear un pedido por HTTP (cotizar, armar el cuerpo y confirmar),
 * contra el servidor de una app de E2E.
 *
 * @param server - Servidor de la app; se pide en cada llamada porque la app arranca en `beforeAll`.
 * @returns `quote`, `orderBody`, `placeOrder` y `createdOrder`.
 */
export function ordersHttp(server: () => Server) {
  /** `POST /cart/quote` (200). */
  async function quote(items: CartLine[]): Promise<CartQuote> {
    const response = await call(server(), newJar(), 'post', '/cart/quote', { body: { items } })
    expect(response.status).toBe(200)
    return response.body as CartQuote
  }

  /** Cuerpo de `POST /orders` con el total que cotiza el back (envío a domicilio). */
  async function orderBody(items: CartLine[], email: string): Promise<OrderBody> {
    const { subtotalArs } = await quote(items)
    return {
      customer: { email, firstName: 'Lucía', lastName: 'Pérez', phone: null },
      shipping: { method: 'home', address: HOME_ADDRESS },
      items,
      paymentMethod: 'mp_redirect',
      expectedTotalArs: subtotalArs + HOME_SHIPPING_ARS,
      website: '',
    }
  }

  /** `POST /orders` con una `Idempotency-Key` (nueva si no se pasa). */
  function placeOrder(jar: Jar, body: unknown, key = randomUUID()): Promise<request.Response> {
    return call(server(), jar, 'post', '/orders', {
      body,
      headers: { 'Idempotency-Key': key },
    })
  }

  /** `POST /orders` que tiene que dar 201: el pedido y su `orderToken`. */
  async function createdOrder(jar: Jar, body: unknown): Promise<CreateOrderResultView> {
    const response = await placeOrder(jar, body)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body as CreateOrderResultView
  }

  return { quote, orderBody, placeOrder, createdOrder }
}
