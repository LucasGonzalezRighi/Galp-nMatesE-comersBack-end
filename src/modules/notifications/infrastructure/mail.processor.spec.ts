import { Logger } from '@nestjs/common'
import { type Job, type Queue, UnrecoverableError } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OutgoingMail } from '../../../shared/application/ports/mail.port'
import type { ComposeEventMailQuery } from '../application/compose-event-mail.query'
import type { MailJobData } from './mail.queue'
import { MailProcessor } from './mail.processor'

const MAIL: OutgoingMail = {
  to: 'ana@mail.com',
  subject: 'Asunto',
  text: 'Texto',
  html: '<p>Texto</p>',
  template: 'payment-approved',
}

function setup(compose: ComposeEventMailQuery['execute'] = () => Promise.resolve(MAIL)) {
  const send = vi.fn<(mail: OutgoingMail) => Promise<void>>(() => Promise.resolve())
  const execute = vi.fn(compose)
  const queue = { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
  const processor = new MailProcessor(
    { send },
    { execute } as unknown as ComposeEventMailQuery,
    queue as unknown as Queue<MailJobData>,
  )
  return { processor, send, execute }
}

function job(data: MailJobData, attemptsMade = 0): Job<MailJobData> {
  return {
    id: 'e1-payment-approved',
    data,
    attemptsMade,
    opts: { attempts: 5 },
  } as Job<MailJobData>
}

const EVENT_JOB: MailJobData = {
  kind: 'event',
  eventId: 'e1',
  eventType: 'order.paid',
  template: 'payment-approved',
  payload: { orderId: 'o1' },
}

describe('MailProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('arma el mail del evento con los datos del momento y lo manda', async () => {
    const { processor, send, execute } = setup()

    await processor.process(job(EVENT_JOB))

    expect(execute).toHaveBeenCalledWith({ eventType: 'order.paid', payload: { orderId: 'o1' } })
    expect(send).toHaveBeenCalledWith(MAIL)
  })

  it('un mail directo (restablecer contraseña) sale tal cual, sin armarse', async () => {
    const { processor, send, execute } = setup()

    await processor.process(job({ kind: 'direct', mail: MAIL }))

    expect(execute).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(MAIL)
  })

  it('si el registro ya no existe no manda nada', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const { processor, send } = setup(() => Promise.resolve(null))

    await processor.process(job(EVENT_JOB))

    expect(send).not.toHaveBeenCalled()
  })

  it('un payload roto falla sin reintentos', async () => {
    const { processor } = setup(() => Promise.reject(new TypeError('sin orderId')))
    await expect(processor.process(job(EVENT_JOB))).rejects.toBeInstanceOf(UnrecoverableError)
  })

  it('agotados los intentos avisa con warn, sin el email (Review Focus 3)', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor } = setup()

    processor.onFailed(job(EVENT_JOB, 5), new Error('550 <ana@mail.com>: mailbox unavailable'))

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toBe(
      'El mail payment-approved (job e1-payment-approved) quedó en fallidos: 550 <a***@mail.com>: mailbox unavailable',
    )
    expect(message).not.toContain('ana@mail.com')
  })

  it('un fallo que se reintenta avisa como mucho una vez por minuto', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor } = setup()

    processor.onFailed(job(EVENT_JOB, 1), new Error('ECONNREFUSED'))
    processor.onFailed(job(EVENT_JOB, 2), new Error('ECONNREFUSED'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('falló y se reintenta')
  })
})
