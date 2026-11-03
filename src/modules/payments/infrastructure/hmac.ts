import { createHmac } from 'node:crypto'

/**
 * HMAC-SHA256 en hex (minúsculas) con `node:crypto`: la función que `ReceiveWebhookCommand`
 * recibe como `HmacSha256` para firmar el manifiesto de `x-signature` (la comparación en tiempo
 * constante la hace el caso de uso con `constantTimeEqual`).
 *
 * @param secret - `MP_WEBHOOK_SECRET` (nunca se loguea).
 * @param manifest - Manifiesto `id:…;request-id:…;ts:…;`.
 * @returns El HMAC en hex.
 * @throws {TypeError} En español, si el secreto está vacío (error de programación: sin secreto el
 *   caso de uso responde 401 antes de firmar).
 */
export function hmacSha256Hex(secret: string, manifest: string): string {
  if (secret === '') throw new TypeError('El secreto del HMAC no puede estar vacío')
  return createHmac('sha256', secret).update(manifest).digest('hex')
}
