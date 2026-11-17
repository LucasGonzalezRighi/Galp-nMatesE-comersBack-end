import { describe, expect, it } from 'vitest'

import type { StoreInfo } from './mail-layout'
import {
  orderCancelledMail,
  orderDeliveredMail,
  orderReceivedMail,
  orderShippedMail,
  paymentApprovedMail,
} from './order-mails'

const STORE: StoreInfo = {
  storeOrigin: 'https://galpon.test',
  contactEmail: 'hola@galpon.test',
  legalName: 'Galpón Mates SRL',
  cuit: '30712345678',
  address: 'Av. Siempreviva 742, CABA',
}

/** Texto y HTML juntos, para buscar frases en los dos. */
function bodies(mail: { text: string; html: string }): string[] {
  return [mail.text, mail.html]
}

describe('order-received', () => {
  const mail = orderReceivedMail(
    {
      number: 'GLP-10001',
      firstName: 'Ana',
      lines: [
        { name: 'Mate Imperial', detail: 'Cuero negro', quantity: 1, totalArs: 46_499 },
        { name: 'Yerba <Suave>', detail: '', quantity: 2, totalArs: 9_000 },
      ],
      shippingCostArs: 6_500,
      totalArs: 61_999,
      reservedUntil: new Date('2026-11-17T18:30:00.000Z'),
    },
    STORE,
  )

  it('lleva el número en el asunto', () => {
    expect(mail.subject).toBe('Recibimos tu pedido GLP-10001')
  })

  it('tiene el resumen, el total, el pago pendiente con la reserva y el arrepentimiento', () => {
    for (const body of bodies(mail)) {
      expect(body).toContain('GLP-10001')
      expect(body).toContain('Mate Imperial (Cuero negro)')
      expect(body).toContain('$46.499')
      expect(body).toContain('$6.500')
      expect(body).toContain('$61.999')
      expect(body).toContain('pendiente de pago')
      expect(body).toContain('17/11/2026 a las 15:30')
      expect(body).toContain('10 días corridos')
      expect(body).toContain('https://galpon.test/arrepentimiento')
      expect(body).toContain('https://galpon.test/terminos')
      expect(body).toContain('https://galpon.test/devoluciones')
      expect(body).toContain('Galpón Mates SRL')
      expect(body).toContain('CUIT 30712345678')
      expect(body).toContain('hola@galpon.test')
    }
  })

  it('escapa el HTML y no lleva imágenes ni rastreo', () => {
    expect(mail.html).toContain('Yerba &lt;Suave&gt;')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).not.toContain('utm_')
    expect(mail.text).toContain('Yerba <Suave>')
  })

  it('valida los datos del pedido', () => {
    expect(() =>
      orderReceivedMail(
        {
          number: ' ',
          firstName: 'Ana',
          lines: [],
          shippingCostArs: 0,
          totalArs: 1,
          reservedUntil: new Date(),
        },
        STORE,
      ),
    ).toThrow('El mail necesita el número de pedido')
  })
})

describe('payment-approved', () => {
  const mail = paymentApprovedMail(
    { number: 'GLP-10001', firstName: 'Ana', totalArs: 61_999 },
    STORE,
  )

  it('confirma el pago con el número y el total', () => {
    expect(mail.subject).toBe('Aprobamos el pago de tu pedido GLP-10001')
    expect(mail.text).toContain('$61.999')
    expect(mail.text).toContain('Hola, Ana:')
    expect(mail.text).toContain('https://galpon.test/devoluciones')
  })
})

describe('order-shipped', () => {
  const mail = orderShippedMail(
    { number: 'GLP-10001', firstName: 'Ana', carrier: 'Andreani', trackingNumber: 'AN123' },
    STORE,
  )

  it('lleva la empresa y el número de seguimiento', () => {
    expect(mail.subject).toBe('Despachamos tu pedido GLP-10001')
    for (const body of bodies(mail)) {
      expect(body).toContain('Andreani')
      expect(body).toContain('AN123')
    }
  })

  it('exige la empresa y el seguimiento', () => {
    expect(() =>
      orderShippedMail(
        { number: 'GLP-10001', firstName: 'Ana', carrier: '', trackingNumber: 'AN123' },
        STORE,
      ),
    ).toThrow('El mail necesita la empresa de envío')
  })
})

describe('order-delivered', () => {
  const mail = orderDeliveredMail({ number: 'GLP-10001', firstName: 'Ana' }, STORE)

  it('avisa la entrega y recuerda el arrepentimiento, los cambios y la garantía', () => {
    expect(mail.subject).toBe('Entregamos tu pedido GLP-10001')
    expect(mail.text).toContain('10 días corridos')
    expect(mail.text).toContain('30 días corridos')
    expect(mail.text).toContain('6 meses')
    expect(mail.text).toContain('https://galpon.test/arrepentimiento')
  })
})

describe('order-cancelled', () => {
  it('vencido: dice en una línea que venció la reserva', () => {
    const mail = orderCancelledMail(
      { number: 'GLP-10001', firstName: 'Ana', reason: 'expired' },
      STORE,
    )
    expect(mail.subject).toBe('Tu pedido GLP-10001 quedó cancelado')
    expect(mail.text).toContain('Motivo: venció el plazo para pagarlo')
  })

  it('cancelado por la tienda: dice el motivo y la devolución del dinero', () => {
    const mail = orderCancelledMail(
      { number: 'GLP-10001', firstName: null, reason: 'cancelled' },
      STORE,
    )
    expect(mail.text).toContain('Hola:')
    expect(mail.text).toContain('Motivo: lo canceló la tienda')
    expect(mail.text).toContain('te devolvemos')
  })
})
