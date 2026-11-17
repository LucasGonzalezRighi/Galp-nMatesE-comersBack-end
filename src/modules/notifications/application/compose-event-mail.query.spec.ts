import { describe, expect, it } from 'vitest'

import { ComposeEventMailQuery, mailTemplateFor } from './compose-event-mail.query'
import type { MailDataReader, OrderMailRecord } from './ports/mail-data.reader.port'

const ORDER: OrderMailRecord = {
  number: 'GLP-10001',
  email: 'invitado@mail.com',
  firstName: 'Ana',
  lines: [{ name: 'Mate Imperial', detail: '', quantity: 1, totalArs: 55_499 }],
  shippingCostArs: 6_500,
  totalArs: 61_999,
  reservedUntil: new Date('2026-11-17T18:30:00.000Z'),
}

/** Lecturas en memoria: un pedido, un arrepentimiento, un contacto y una cuenta. */
const READER: MailDataReader = {
  order: (id) => Promise.resolve(id === 'o1' ? ORDER : null),
  withdrawal: (id) =>
    Promise.resolve(
      id === 'w1' ? { email: 'arre@mail.com', code: 'ARR-000007', orderNumber: null } : null,
    ),
  contactEmail: (id) => Promise.resolve(id === 'c1' ? 'contacto@mail.com' : null),
  account: (id) =>
    Promise.resolve(id === 'u1' ? { email: 'cuenta@mail.com', firstName: 'Leo' } : null),
  storeInfo: () =>
    Promise.resolve({
      contactEmail: 'hola@galpon.test',
      legalName: null,
      cuit: null,
      address: null,
    }),
}

const query = new ComposeEventMailQuery(READER, 'http://localhost:3000/')

describe('ComposeEventMailQuery', () => {
  it('order.created → order-received al email del pedido, con los enlaces de STORE_ORIGIN', async () => {
    const mail = await query.execute({ eventType: 'order.created', payload: { orderId: 'o1' } })
    expect(mail?.template).toBe('order-received')
    expect(mail?.to).toBe('invitado@mail.com')
    expect(mail?.text).toContain('http://localhost:3000/terminos')
    expect(mail?.text).toContain('$61.999')
  })

  it.each([
    ['order.paid', 'payment-approved'],
    ['order.delivered', 'order-delivered'],
    ['order.cancelled', 'order-cancelled'],
    ['order.expired', 'order-cancelled'],
  ])('%s → %s', async (eventType, template) => {
    const mail = await query.execute({ eventType, payload: { orderId: 'o1', number: 'GLP-10001' } })
    expect(mail?.template).toBe(template)
    expect(mail?.to).toBe('invitado@mail.com')
  })

  it('order.expired dice que venció; order.cancelled, que lo canceló la tienda', async () => {
    const expired = await query.execute({ eventType: 'order.expired', payload: { orderId: 'o1' } })
    const cancelled = await query.execute({
      eventType: 'order.cancelled',
      payload: { orderId: 'o1' },
    })
    expect(expired?.text).toContain('venció el plazo')
    expect(cancelled?.text).toContain('lo canceló la tienda')
  })

  it('order.shipped usa la empresa y el seguimiento del evento', async () => {
    const mail = await query.execute({
      eventType: 'order.shipped',
      payload: { orderId: 'o1', carrier: 'Correo Argentino', trackingNumber: 'CA999' },
    })
    expect(mail?.template).toBe('order-shipped')
    expect(mail?.text).toContain('Correo Argentino')
    expect(mail?.text).toContain('CA999')
  })

  it('arrepentimiento, contacto y registro van al email de cada registro', async () => {
    const withdrawal = await query.execute({
      eventType: 'withdrawal.requested',
      payload: { requestId: 'w1' },
    })
    const contact = await query.execute({
      eventType: 'contact.received',
      payload: { messageId: 'c1' },
    })
    const account = await query.execute({
      eventType: 'customer.registered',
      payload: { customerId: 'u1' },
    })
    expect(withdrawal).toMatchObject({ to: 'arre@mail.com', template: 'withdrawal-code' })
    expect(withdrawal?.text).toContain('ARR-000007')
    expect(contact).toMatchObject({ to: 'contacto@mail.com', template: 'contact-received' })
    expect(account).toMatchObject({ to: 'cuenta@mail.com', template: 'account-created' })
  })

  it('sin registro (borrado) o con un evento sin mail devuelve null', async () => {
    await expect(
      query.execute({ eventType: 'order.paid', payload: { orderId: 'otro' } }),
    ).resolves.toBeNull()
    await expect(
      query.execute({ eventType: 'combo.changed', payload: { comboId: 'x' } }),
    ).resolves.toBeNull()
  })

  it('un payload sin id lanza en español', async () => {
    await expect(query.execute({ eventType: 'order.paid', payload: {} })).rejects.toThrow(
      'El evento order.paid no trae orderId',
    )
  })

  it('mailTemplateFor no confunde propiedades heredadas con eventos', () => {
    expect(mailTemplateFor('toString')).toBeNull()
    expect(mailTemplateFor('order.created')).toBe('order-received')
  })
})
