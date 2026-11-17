import type { Job } from 'bullmq'
import { createTransport } from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'

import type { OutgoingMail } from '../../../shared/application/ports/mail.port'
import { LogMail, type MailLogger } from './log-mail.adapter'
import { DIRECT_MAIL_JOB_OPTIONS, type MailJobData } from './mail.queue'
import { QueuedPasswordResetMailer } from './queued-password-reset.mailer'
import { SmtpMail } from './smtp-mail.adapter'

const MAIL: OutgoingMail = {
  to: 'lucas@dominio.com',
  subject: 'Recibimos tu pedido GLP-10001',
  text: 'Hola, Lucas: secreto del cuerpo',
  html: '<p>Hola, Lucas: secreto del cuerpo</p>',
  template: 'order-received',
}

describe('LogMail', () => {
  it('loguea la plantilla y el destinatario enmascarado, nunca el email entero ni el cuerpo', async () => {
    const log = vi.fn<MailLogger['log']>()

    await new LogMail({ log }).send(MAIL)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toEqual({ to: 'l***@dominio.com', template: 'order-received' })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('lucas@dominio.com')
    expect(logged).not.toContain('secreto del cuerpo')
    expect(logged).not.toContain('GLP-10001')
  })

  it('rechaza un mail sin destinatario', async () => {
    await expect(new LogMail({ log: vi.fn() }).send({ ...MAIL, to: ' ' })).rejects.toThrow(
      'El mail necesita destinatario',
    )
  })
})

describe('SmtpMail (transporte de prueba de nodemailer, sin red)', () => {
  it('manda remitente, destinatario, asunto, texto y HTML', async () => {
    const transport = createTransport({ jsonTransport: true })
    const sendMail = vi.spyOn(transport, 'sendMail')

    await new SmtpMail(transport, 'Galpón Mates <hola@galpon.test>').send(MAIL)

    expect(sendMail).toHaveBeenCalledTimes(1)
    const info = (await sendMail.mock.results[0]?.value) as { message: string }
    const sent = JSON.parse(info.message) as {
      from: { address: string }
      to: { address: string }[]
      subject: string
      text: string
      html: string
    }
    expect(sent.from.address).toBe('hola@galpon.test')
    expect(sent.to.map((to) => to.address)).toEqual(['lucas@dominio.com'])
    expect(sent.subject).toBe(MAIL.subject)
    expect(sent.text).toBe(MAIL.text)
    expect(sent.html).toBe(MAIL.html)
  })

  it('si el servidor rechaza, el error sube (la cola reintenta)', async () => {
    const transport = { sendMail: vi.fn(() => Promise.reject(new Error('421 servicio caído'))) }
    await expect(new SmtpMail(transport, 'hola@galpon.test').send(MAIL)).rejects.toThrow(
      '421 servicio caído',
    )
  })

  it('exige remitente', () => {
    expect(() => new SmtpMail({ sendMail: vi.fn() }, ' ')).toThrow(
      'El envío por SMTP necesita el remitente',
    )
  })
})

describe('QueuedPasswordResetMailer', () => {
  it('encola el mail ya armado, directo y para borrarse al completarse', async () => {
    const add = vi.fn<(...args: unknown[]) => Promise<Job<MailJobData>>>(() =>
      Promise.resolve({} as Job<MailJobData>),
    )
    const reader = {
      storeInfo: () =>
        Promise.resolve({
          contactEmail: 'hola@galpon.test',
          legalName: null,
          cuit: null,
          address: null,
        }),
    }
    const link = 'http://localhost:3000/cuenta/restablecer?token=rt_abc'

    await new QueuedPasswordResetMailer(
      { add },
      reader,
      'http://localhost:3000/',
    ).sendPasswordReset({
      to: 'ana@mail.com',
      firstName: 'Ana',
      link,
    })

    expect(add).toHaveBeenCalledTimes(1)
    const [name, data, opts] = add.mock.calls[0] as unknown as [
      string,
      { kind: string; mail: OutgoingMail },
      { removeOnComplete: unknown; removeOnFail: unknown; jobId: string },
    ]
    expect(name).toBe('mail.send')
    expect(data.kind).toBe('direct')
    expect(data.mail).toMatchObject({ to: 'ana@mail.com', template: 'password-reset' })
    expect(data.mail.text).toContain(link)
    expect(opts.removeOnComplete).toBe(DIRECT_MAIL_JOB_OPTIONS.removeOnComplete)
    // Un mail que agota sus intentos no deja el email y el enlace con el token en Redis más de un día.
    expect(opts.removeOnFail).toEqual({ age: 24 * 60 * 60 })
    expect(opts.jobId).toMatch(/^password-reset-/)
  })

  const storeReader = {
    storeInfo: () =>
      Promise.resolve({
        contactEmail: 'hola@galpon.test',
        legalName: null,
        cuit: null,
        address: null,
      }),
  }

  it('encola el aviso de cuenta eliminada con las mismas opciones que los directos', async () => {
    const add = vi.fn<(...args: unknown[]) => Promise<Job<MailJobData>>>(() =>
      Promise.resolve({} as Job<MailJobData>),
    )

    await new QueuedPasswordResetMailer(
      { add },
      storeReader,
      'http://localhost:3000',
    ).sendAccountDeleted({ to: 'ana@mail.com', firstName: 'Ana' })

    expect(add).toHaveBeenCalledTimes(1)
    const [, data, opts] = add.mock.calls[0] as unknown as [
      string,
      { kind: string; mail: OutgoingMail },
      { removeOnComplete: unknown; removeOnFail: unknown; jobId: string },
    ]
    expect(data.mail).toMatchObject({ to: 'ana@mail.com', template: 'account-deleted' })
    expect(opts.removeOnComplete).toBe(true)
    expect(opts.removeOnFail).toEqual({ age: 24 * 60 * 60 })
    expect(opts.jobId).toMatch(/^account-deleted-/)
  })

  it('si Redis no acepta el aviso de cuenta eliminada, no lanza (la cuenta ya se borró)', async () => {
    const add = vi.fn(() => Promise.reject(new Error('Redis caído')))

    await expect(
      new QueuedPasswordResetMailer(
        { add },
        storeReader,
        'http://localhost:3000',
      ).sendAccountDeleted({ to: 'ana@mail.com', firstName: 'Ana' }),
    ).resolves.toBeUndefined()
  })
})
