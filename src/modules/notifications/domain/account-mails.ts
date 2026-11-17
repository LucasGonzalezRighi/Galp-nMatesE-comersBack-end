import {
  greetingFor,
  type RenderedMail,
  renderMail,
  requireMailText,
  STORE_NAME,
  type StoreInfo,
  storeUrl,
} from './mail-layout'
import { WITHDRAWAL_DAYS } from './order-mails'

/** Datos del mail `withdrawal-code`. */
export interface WithdrawalCodeInput {
  /** Código de la solicitud (`ARR-000123`). */
  code: string
  /** Número del pedido que se informó, o `null`. */
  orderNumber: string | null
}

/** Datos de los mails de la cuenta. */
export interface AccountMailInput {
  /** Nombre de la cuenta, o `null` para un saludo sin nombre. */
  firstName: string | null
}

/** Datos del mail `password-reset`. */
export interface PasswordResetInput extends AccountMailInput {
  /** Enlace a la tienda con el token (`…/cuenta/restablecer?token=rt_…`). */
  link: string
}

/**
 * Mail `withdrawal-code` (evento `withdrawal.requested`): el código de la solicitud por el mismo
 * medio (Disp. 954/2025 art. 5). El saludo no lleva nombre ni repite el comentario: el formulario
 * no verifica el email, así que el mail no reproduce nada que haya escrito quien lo llenó.
 *
 * @param input - Código y número de pedido.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el código.
 */
export function withdrawalCodeMail(input: WithdrawalCodeInput, store: StoreInfo): RenderedMail {
  const code = requireMailText(input.code, 'el código de arrepentimiento')
  const order = input.orderNumber?.trim() ?? ''
  return renderMail(
    {
      subject: `Recibimos tu arrepentimiento (${code})`,
      greeting: greetingFor(null),
      blocks: [
        {
          kind: 'paragraph',
          text: `Recibimos tu solicitud de arrepentimiento${order === '' ? '' : ` del pedido ${order}`}. El código es ${code}: guardalo como comprobante.`,
        },
        {
          kind: 'paragraph',
          text: `Dentro de los ${String(WITHDRAWAL_DAYS)} días corridos la revocación es sin costo: te escribimos para coordinar la devolución, el envío de vuelta lo pagamos nosotros y te reintegramos lo que pagaste.`,
        },
        { kind: 'link', label: 'Cambios y devoluciones', url: storeUrl(store, '/devoluciones') },
      ],
    },
    store,
  )
}

/**
 * Mail `contact-received` (evento `contact.received`): avisa que el mensaje llegó, sin repetir lo
 * que se escribió ni el nombre (el formulario no verifica el email).
 *
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 */
export function contactReceivedMail(store: StoreInfo): RenderedMail {
  return renderMail(
    {
      subject: 'Recibimos tu mensaje',
      greeting: greetingFor(null),
      blocks: [
        {
          kind: 'paragraph',
          text: `Recibimos tu mensaje en ${STORE_NAME} y te respondemos a este mismo email lo antes posible.`,
        },
        {
          kind: 'paragraph',
          text: `Si no lo mandaste vos, ignorá este mail. Para cualquier cosa, escribinos a ${store.contactEmail}.`,
        },
      ],
    },
    store,
  )
}

/**
 * Mail `password-reset`: el enlace para cambiar la contraseña (vence en 60 minutos y sirve una
 * vez).
 *
 * @param input - Nombre y enlace.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si el enlace falta o no es http o https.
 */
export function passwordResetMail(input: PasswordResetInput, store: StoreInfo): RenderedMail {
  const link = requireMailText(input.link, 'el enlace para cambiar la contraseña')
  return renderMail(
    {
      subject: `Cambiá tu contraseña de ${STORE_NAME}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pediste cambiar la contraseña de tu cuenta. Entrá a este enlace para elegir una nueva: vence en 60 minutos y sirve una sola vez.',
        },
        { kind: 'link', label: 'Elegir una contraseña nueva', url: link },
        {
          kind: 'paragraph',
          text: 'Si no lo pediste, ignorá este mail: tu contraseña no cambia.',
        },
      ],
    },
    store,
  )
}

/**
 * Mail `account-created` (evento `customer.registered`).
 *
 * @param input - Nombre de la cuenta.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 */
export function accountCreatedMail(input: AccountMailInput, store: StoreInfo): RenderedMail {
  return renderMail(
    {
      subject: `Tu cuenta en ${STORE_NAME} está lista`,
      greeting: greetingFor(input.firstName),
      blocks: [
        {
          kind: 'paragraph',
          text: 'Creaste tu cuenta: desde ahí ves tus pedidos y guardás tus direcciones.',
        },
        { kind: 'link', label: 'Mi cuenta', url: storeUrl(store, '/cuenta') },
        {
          kind: 'paragraph',
          text: 'Si no la creaste vos, escribinos y la damos de baja. Cómo usamos tus datos:',
        },
        { kind: 'link', label: 'Política de privacidad', url: storeUrl(store, '/privacidad') },
      ],
    },
    store,
  )
}

/**
 * Mail `account-deleted` (lo conecta la Task 3 con `DELETE /me`).
 *
 * @param input - Nombre de la cuenta (el que tenía antes de anonimizarla).
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 */
export function accountDeletedMail(input: AccountMailInput, store: StoreInfo): RenderedMail {
  return renderMail(
    {
      subject: `Eliminamos tu cuenta de ${STORE_NAME}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        {
          kind: 'paragraph',
          text: 'Eliminamos tu cuenta: borramos tus datos personales, tus direcciones y tus sesiones.',
        },
        {
          kind: 'paragraph',
          text: 'Tus pedidos quedan guardados sin vínculo con tu cuenta, solo con los datos mínimos del comprobante, porque la ley nos obliga a conservarlos.',
        },
        { kind: 'link', label: 'Política de privacidad', url: storeUrl(store, '/privacidad') },
      ],
    },
    store,
  )
}
