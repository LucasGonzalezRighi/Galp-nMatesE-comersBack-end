// Páginas HTML del simulador de Mercado Pago (Ruling B-55, solo en `MP_MODE=simulated`): el
// checkout de una preferencia y el desafío 3-D Secure, con los textos del simulador de la tienda.
// HTML plano, sin frameworks ni recursos externos; todo lo variable pasa por `escapeHtml`. Los
// formularios postean a `resolve` (relativo a la página) y el único script es el `postMessage`
// del final del desafío, permitido por su hash en la CSP.

import { createHash } from 'node:crypto'

import { formatPesos } from '../../orders/domain/format-pesos'

/** Página lista para responder: estado HTTP, HTML y la CSP propia. */
export interface SimulatorPage {
  /** Estado HTTP. */
  status: number
  /** Documento HTML completo. */
  html: string
  /** `Content-Security-Policy` de la página (reemplaza la de helmet). */
  csp: string
}

/** Script del final del desafío: avisa al diálogo de la tienda (que está en otro origen). */
const CHALLENGE_DONE_SCRIPT =
  "try { parent.postMessage({ type: 'galpon:challenge-done' }, '*') } catch (error) {}"

/** Hash del script para `script-src` (la CSP de helmet no permite scripts en línea). */
const CHALLENGE_DONE_SCRIPT_HASH = `'sha256-${createHash('sha256').update(CHALLENGE_DONE_SCRIPT, 'utf8').digest('base64')}'`

/** Estilos mínimos, en línea. */
const STYLES = [
  'body{margin:0;font-family:system-ui,sans-serif;background:#f5f5f5;color:#1a1a1a}',
  'main{max-width:28rem;margin:3rem auto;padding:1.5rem;background:#fff;border-radius:.75rem}',
  'header{margin-bottom:1.5rem}.brand{font-weight:700;margin:0}.mode{margin:0;color:#666}',
  'h1{font-size:1.25rem}dl{display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem}',
  'dt{color:#666}dd{margin:0;font-weight:600}form{display:grid;gap:.75rem;margin-top:1.5rem}',
  'button{padding:.75rem;border-radius:.5rem;border:1px solid #009ee3;background:#fff;color:#009ee3;font-size:1rem;cursor:pointer}',
  'button.primary{background:#009ee3;color:#fff}',
].join('')

/**
 * Escapa un texto para ponerlo en HTML (contenido o atributo entre comillas).
 *
 * @param value - Texto cualquiera.
 * @returns El texto con `&`, `<`, `>`, `"` y `'` escapados.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * CSP de las páginas del simulador: nada externo, estilos en línea, el script del desafío por
 * hash, formularios al back y a la tienda (el `resolve` redirige ahí) y embebible por la tienda
 * (el desafío se abre en un `iframe` de su diálogo).
 *
 * @param storeOrigin - Origen de la tienda.
 * @param script - Si la página lleva el script del desafío.
 * @returns La política.
 */
function contentSecurityPolicy(storeOrigin: string, script: boolean): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${script ? CHALLENGE_DONE_SCRIPT_HASH : "'none'"}`,
    `form-action 'self' ${storeOrigin}`,
    `frame-ancestors 'self' ${storeOrigin}`,
    "base-uri 'none'",
  ].join('; ')
}

/** Documento completo con el encabezado del simulador. */
function layout(title: string, body: string, script = false): string {
  return [
    '<!doctype html>',
    '<html lang="es-AR">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)} · Mercado Pago (simulador)</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<header><p class="brand">Mercado Pago</p><p class="mode">Simulador · modo de prueba</p></header>',
    body,
    '</main>',
    script ? `<script>${CHALLENGE_DONE_SCRIPT}</script>` : '',
    '</body>',
    '</html>',
  ].join('\n')
}

/** Botón que manda `result` con el valor dado. */
function resultButton(value: string, label: string, primary = false): string {
  const kind = primary ? ' class="primary"' : ''
  return `<button type="submit" name="result" value="${escapeHtml(value)}"${kind}>${escapeHtml(label)}</button>`
}

/**
 * Checkout de una preferencia: el pedido, el total y los tres resultados posibles.
 *
 * @param input - Preferencia, número y total del pedido, y origen de la tienda.
 * @returns La página (200).
 * @throws {RangeError} En español, si el total no es un entero no negativo.
 */
export function checkoutPage(input: {
  preferenceId: string
  number: string
  totalArs: number
  storeOrigin: string
}): SimulatorPage {
  const body = [
    '<h1>Elegí cómo termina el pago</h1>',
    '<dl>',
    `<dt>Pedido</dt><dd>${escapeHtml(input.number)}</dd>`,
    `<dt>Total</dt><dd>${escapeHtml(formatPesos(input.totalArs))}</dd>`,
    '</dl>',
    '<form method="post" action="resolve">',
    `<input type="hidden" name="preference" value="${escapeHtml(input.preferenceId)}">`,
    resultButton('approved', 'Aprobar', true),
    resultButton('pending', 'Dejar pendiente'),
    resultButton('rejected', 'Rechazar'),
    '</form>',
  ].join('\n')
  return {
    status: 200,
    html: layout('Elegí cómo termina el pago', body),
    csp: contentSecurityPolicy(input.storeOrigin, false),
  }
}

/**
 * Desafío 3-D Secure de un pago: confirmar o cancelar la verificación del banco.
 *
 * @param input - Pago y origen de la tienda.
 * @returns La página (200).
 */
export function challengePage(input: {
  providerPaymentId: string
  storeOrigin: string
}): SimulatorPage {
  const body = [
    '<h1>Verificación de tu banco (simulada)</h1>',
    '<p>Así se ve el paso en que el banco confirma que sos vos.</p>',
    '<form method="post" action="resolve">',
    `<input type="hidden" name="payment" value="${escapeHtml(input.providerPaymentId)}">`,
    resultButton('challenge_ok', 'Confirmar', true),
    resultButton('challenge_failed', 'Cancelar'),
    '</form>',
  ].join('\n')
  return {
    status: 200,
    html: layout('Verificación de tu banco (simulada)', body),
    csp: contentSecurityPolicy(input.storeOrigin, false),
  }
}

/**
 * Final del desafío: avisa al diálogo de la tienda con `postMessage` y pide cerrar la ventana.
 *
 * @param storeOrigin - Origen de la tienda.
 * @returns La página (200), con el único script permitido.
 */
export function challengeDonePage(storeOrigin: string): SimulatorPage {
  return {
    status: 200,
    html: layout('Verificación terminada', '<p>Listo. Ya podés cerrar esta ventana.</p>', true),
    csp: contentSecurityPolicy(storeOrigin, true),
  }
}

/**
 * Link del simulador sin preferencia, o con una que no existe.
 *
 * @param storeOrigin - Origen de la tienda.
 * @returns La página (404).
 */
export function invalidLinkPage(storeOrigin: string): SimulatorPage {
  return {
    status: 404,
    html: layout(
      'Link inválido',
      '<p>Este link de pago no sirve: le falta el pedido o el intento de pago.</p>',
    ),
    csp: contentSecurityPolicy(storeOrigin, false),
  }
}
