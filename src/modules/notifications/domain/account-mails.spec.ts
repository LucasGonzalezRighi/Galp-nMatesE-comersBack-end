import { describe, expect, it } from 'vitest'

import {
  accountCreatedMail,
  accountDeletedMail,
  contactReceivedMail,
  passwordResetMail,
  withdrawalCodeMail,
} from './account-mails'
import { maskEmail, maskEmailsIn, type StoreInfo } from './mail-layout'

const STORE: StoreInfo = {
  storeOrigin: 'http://localhost:3000',
  contactEmail: 'hola@galpon.test',
  legalName: null,
  cuit: null,
  address: null,
}

describe('withdrawal-code', () => {
  const mail = withdrawalCodeMail({ code: 'ARR-000123', orderNumber: 'GLP-10001' }, STORE)

  it('lleva el código en el asunto y en el cuerpo, con el pedido', () => {
    expect(mail.subject).toBe('Recibimos tu arrepentimiento (ARR-000123)')
    expect(mail.text).toContain('ARR-000123')
    expect(mail.html).toContain('ARR-000123')
    expect(mail.text).toContain('GLP-10001')
    expect(mail.text).toContain('sin costo')
  })

  it('sin pedido no lo menciona y exige el código', () => {
    expect(withdrawalCodeMail({ code: 'ARR-000124', orderNumber: null }, STORE).text).not.toContain(
      'GLP-',
    )
    expect(() => withdrawalCodeMail({ code: '', orderNumber: null }, STORE)).toThrow(
      'El mail necesita el código de arrepentimiento',
    )
  })
})

describe('contact-received', () => {
  it('confirma que llegó el mensaje sin repetir lo que escribió', () => {
    const mail = contactReceivedMail(STORE)
    expect(mail.subject).toBe('Recibimos tu mensaje')
    expect(mail.text).toContain('Hola:')
    expect(mail.text).toContain('hola@galpon.test')
  })
})

describe('password-reset', () => {
  const link = 'http://localhost:3000/cuenta/restablecer?token=rt_abc'

  it('lleva el enlace, el vencimiento y qué hacer si no lo pidió', () => {
    const mail = passwordResetMail({ firstName: 'Ana', link }, STORE)
    expect(mail.subject).toBe('Cambiá tu contraseña de Galpón Mates')
    expect(mail.text).toContain(link)
    expect(mail.html).toContain(`href="${link}"`)
    expect(mail.text).toContain('60 minutos')
    expect(mail.text).toContain('Si no lo pediste')
  })

  it('exige un enlace http(s)', () => {
    expect(() =>
      passwordResetMail({ firstName: 'Ana', link: 'javascript:alert(1)' }, STORE),
    ).toThrow('http o https')
  })
})

describe('account-created', () => {
  it('da la bienvenida con los enlaces a la cuenta y a la privacidad', () => {
    const mail = accountCreatedMail({ firstName: 'Ana' }, STORE)
    expect(mail.subject).toBe('Tu cuenta en Galpón Mates está lista')
    expect(mail.text).toContain('Hola, Ana:')
    expect(mail.text).toContain('http://localhost:3000/cuenta')
    expect(mail.text).toContain('http://localhost:3000/privacidad')
  })
})

describe('account-deleted', () => {
  it('confirma la baja y que los pedidos quedan sin vínculo a la cuenta', () => {
    const mail = accountDeletedMail({ firstName: 'Ana' }, STORE)
    expect(mail.subject).toBe('Eliminamos tu cuenta de Galpón Mates')
    expect(mail.text).toContain('sin vínculo con tu cuenta')
    expect(mail.text).toContain('http://localhost:3000/privacidad')
  })
})

describe('maskEmail', () => {
  it('deja la primera letra y el dominio', () => {
    expect(maskEmail('lucas@dominio.com')).toBe('l***@dominio.com')
    expect(maskEmail('sin-arroba')).toBe('***')
  })

  it('enmascara los emails dentro de un texto', () => {
    expect(maskEmailsIn('550 <ana@mail.com>: Recipient rejected')).toBe(
      '550 <a***@mail.com>: Recipient rejected',
    )
  })
})
