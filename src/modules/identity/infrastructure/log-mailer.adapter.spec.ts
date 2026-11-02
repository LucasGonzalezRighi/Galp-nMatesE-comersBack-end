import { describe, expect, it, vi } from 'vitest'

import type { PasswordResetMail } from '../application/ports/mailer.port'
import { LogMailer, type MailLogger } from './log-mailer.adapter'

const MAIL: PasswordResetMail = {
  to: 'ana@mail.com',
  firstName: 'Ana',
  link: 'http://localhost:3000/cuenta/restablecer?token=rt_0123',
}

/** Logger simulado que anota cada llamada. */
function fakeLogger() {
  const log = vi.fn<MailLogger['log']>()
  const warn = vi.fn<MailLogger['warn']>()
  return { logger: { log, warn }, log, warn }
}

describe('LogMailer', () => {
  it.each(['development', 'test'] as const)(
    'en %s registra destinatario, tipo y el link completo',
    async (nodeEnv) => {
      const { logger, log, warn } = fakeLogger()

      await new LogMailer(nodeEnv, logger).sendPasswordReset(MAIL)

      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]?.[0]).toEqual({
        to: 'ana@mail.com',
        kind: 'password-reset',
        link: MAIL.link,
      })
      expect(warn).not.toHaveBeenCalled()
    },
  )

  it('en production no registra el link y avisa que falta el proveedor', async () => {
    const { logger, log, warn } = fakeLogger()

    await new LogMailer('production', logger).sendPasswordReset(MAIL)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toEqual({ to: 'ana@mail.com', kind: 'password-reset' })
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain('rt_0123')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('proveedor')
  })

  it('rechaza un mail sin destinatario o sin link', async () => {
    const mailer = new LogMailer('development', fakeLogger().logger)

    await expect(mailer.sendPasswordReset({ ...MAIL, to: ' ' })).rejects.toThrow(
      'El mail de recuperación necesita destinatario',
    )
    await expect(mailer.sendPasswordReset({ ...MAIL, link: '' })).rejects.toThrow(
      'El mail de recuperación necesita el enlace',
    )
  })
})
