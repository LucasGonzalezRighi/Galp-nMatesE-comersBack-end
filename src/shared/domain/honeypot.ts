/**
 * Indica si el campo trampa (`website`, `Honeypot` del contrato) vino lleno: cualquier texto que
 * no sea vacío, un espacio también (como el mock). Las personas no lo ven y lo dejan en `null` o
 * `''`. Lo usan los formularios públicos: el pedido, el contacto, el arrepentimiento y las reseñas.
 *
 * @param website - Valor del campo trampa.
 * @returns `true` si lo llenó un bot.
 */
export function isHoneypotFilled(website: string | null): boolean {
  return website !== null && website !== ''
}
