/** Plantillas de mail de la tienda (LS-6), una por mail que se manda. */
export const MAIL_TEMPLATES = [
  'order-received',
  'payment-approved',
  'order-shipped',
  'order-delivered',
  'order-cancelled',
  'withdrawal-code',
  'contact-received',
  'password-reset',
  'account-created',
  'account-deleted',
] as const

/** Nombre de una plantilla de mail. */
export type MailTemplate = (typeof MAIL_TEMPLATES)[number]
