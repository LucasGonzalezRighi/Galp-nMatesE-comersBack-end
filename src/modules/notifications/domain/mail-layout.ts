/** Nombre de la tienda en los mails. */
export const STORE_NAME = 'Galpón Mates'

/** Zona horaria de las fechas de los mails. */
const STORE_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Datos de la tienda que van en todos los mails (salen de los ajustes y de `STORE_ORIGIN`). */
export interface StoreInfo {
  /** Origen de la tienda, sin barra final (`https://galponmates.com.ar`). */
  storeOrigin: string
  /** Email de contacto de los ajustes. */
  contactEmail: string
  /** Razón social del vendedor, o `null` si no se cargó. */
  legalName: string | null
  /** CUIT del vendedor, o `null`. */
  cuit: string | null
  /** Domicilio del vendedor, o `null`. */
  address: string | null
}

/** Asunto y cuerpo de un mail, en texto plano y en HTML simple. */
export interface RenderedMail {
  /** Asunto. */
  subject: string
  /** Cuerpo en texto plano. */
  text: string
  /** Cuerpo en HTML (sin imágenes, estilos externos ni rastreo). */
  html: string
}

/** Párrafo de un mail. */
export interface MailParagraph {
  /** Tipo de bloque. */
  kind: 'paragraph'
  /** Texto del párrafo. */
  text: string
}

/** Lista con viñetas de un mail. */
export interface MailList {
  /** Tipo de bloque. */
  kind: 'list'
  /** Renglones de la lista. */
  items: string[]
}

/** Enlace a la tienda de un mail. */
export interface MailLink {
  /** Tipo de bloque. */
  kind: 'link'
  /** Texto del enlace. */
  label: string
  /** URL completa (de la tienda, sin parámetros de rastreo). */
  url: string
}

/** Un bloque del cuerpo de un mail. */
export type MailBlock = MailParagraph | MailList | MailLink

/** Lo que arma un mail: asunto, saludo y bloques. */
export interface MailLayout {
  /** Asunto. */
  subject: string
  /** Saludo (`Hola, Ana:`). */
  greeting: string
  /** Bloques del cuerpo, en orden. */
  blocks: MailBlock[]
}

/**
 * Revisa que un texto obligatorio de un mail no esté vacío.
 *
 * @param value - El texto.
 * @param field - Qué es, para el mensaje.
 * @returns El texto recortado.
 * @throws {TypeError} En español, si está vacío.
 */
export function requireMailText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new TypeError(`El mail necesita ${field}`)
  return trimmed
}

/**
 * Saludo del mail: con el nombre si se conoce; si no, genérico.
 *
 * @param firstName - Nombre, o `null` para un saludo sin nombre.
 * @returns `Hola, Ana:` u `Hola:`.
 */
export function greetingFor(firstName: string | null): string {
  const name = firstName?.trim() ?? ''
  return name === '' ? 'Hola:' : `Hola, ${name}:`
}

/**
 * Enlace a una ruta de la tienda.
 *
 * @param store - Datos de la tienda (el origen).
 * @param path - Ruta, empezando con `/` (por ejemplo `/terminos`).
 * @returns La URL completa.
 * @throws {TypeError} En español, si la ruta no empieza con `/`.
 */
export function storeUrl(store: Pick<StoreInfo, 'storeOrigin'>, path: string): string {
  if (!path.startsWith('/')) {
    throw new TypeError(`La ruta de la tienda tiene que empezar con /: ${path}`)
  }
  return `${store.storeOrigin.replace(/\/+$/, '')}${path}`
}

/** Enlaces legales que llevan los mails de pedidos (LS-6, tabla (a) fila 4). */
export function legalLinks(store: Pick<StoreInfo, 'storeOrigin'>): MailLink[] {
  return [
    { kind: 'link', label: 'Términos y condiciones', url: storeUrl(store, '/terminos') },
    { kind: 'link', label: 'Cambios y devoluciones', url: storeUrl(store, '/devoluciones') },
  ]
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('es-AR', {
  timeZone: STORE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Fecha y hora de Argentina, para los mails.
 *
 * @param date - La fecha.
 * @returns Por ejemplo `17/11/2026 a las 15:30`.
 * @throws {TypeError} En español, si la fecha no es válida.
 */
export function formatMailDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new TypeError('La fecha del mail no es válida')
  const parts = new Map(DATE_TIME_FORMAT.formatToParts(date).map((p) => [p.type, p.value]))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.get(type) ?? ''
  return `${part('day')}/${part('month')}/${part('year')} a las ${part('hour')}:${part('minute')}`
}

/**
 * Escapa un texto para meterlo en HTML.
 *
 * @param value - El texto.
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

/** Renglones del pie con los datos del vendedor que estén cargados. */
function footerLines(store: StoreInfo): string[] {
  const seller = [store.legalName, store.cuit === null ? null : `CUIT ${store.cuit}`, store.address]
    .map((line) => line?.trim() ?? '')
    .filter((line) => line !== '')
  return [
    seller.length > 0 ? `${STORE_NAME} · ${seller.join(' · ')}` : STORE_NAME,
    `Consultas: ${store.contactEmail}`,
    'Este mail es sobre tu compra o tu cuenta: no mandamos publicidad.',
  ]
}

/**
 * Arma el mail en texto plano y en HTML con el mismo contenido. Todo el texto se escapa; los
 * enlaces son los de la tienda, sin parámetros de rastreo, y no hay imágenes.
 *
 * @param layout - Asunto, saludo y bloques.
 * @param store - Datos de la tienda para el pie.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el asunto o el email de contacto, o si un enlace no
 *   es http o https.
 */
export function renderMail(layout: MailLayout, store: StoreInfo): RenderedMail {
  const subject = requireMailText(layout.subject, 'asunto')
  requireMailText(store.contactEmail, 'el email de contacto de la tienda')
  const text: string[] = [layout.greeting]
  const html: string[] = [`<p>${escapeHtml(layout.greeting)}</p>`]
  for (const block of layout.blocks) {
    switch (block.kind) {
      case 'paragraph':
        text.push(block.text)
        html.push(`<p>${escapeHtml(block.text)}</p>`)
        break
      case 'list':
        text.push(block.items.map((item) => `- ${item}`).join('\n'))
        html.push(`<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
        break
      case 'link':
        if (!/^https?:\/\//.test(block.url)) {
          throw new TypeError(`Un enlace del mail tiene que ser http o https: ${block.url}`)
        }
        text.push(`${block.label}: ${block.url}`)
        html.push(`<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label)}</a></p>`)
        break
    }
  }
  const footer = footerLines(store)
  text.push(`--\n${footer.join('\n')}`)
  html.push(`<hr><p><small>${footer.map(escapeHtml).join('<br>')}</small></p>`)
  return {
    subject,
    text: `${text.join('\n\n')}\n`,
    html: `<!doctype html><html lang="es"><body>${html.join('')}</body></html>`,
  }
}

/**
 * Enmascara un email para los logs: la primera letra, `***` y el dominio (`l***@dominio.com`).
 *
 * @param email - El email.
 * @returns El email enmascarado; `***` si no tiene la forma `algo@dominio`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

/**
 * Enmascara todos los emails de un texto (por ejemplo, el error de un servidor SMTP).
 *
 * @param text - El texto.
 * @returns El texto con cada email como en {@link maskEmail}.
 */
export function maskEmailsIn(text: string): string {
  return text.replace(/[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+/g, (email) => maskEmail(email))
}
