import { describe, expect, it } from 'vitest'

import type { Clock } from '../../../shared/domain/clock'
import type { ContactMessage, NewContactMessage } from '../domain/contact-message'
import { formatWithdrawalCode } from '../domain/contact-message'
import { MessageNotFoundError } from '../domain/support-errors'
import { MarkMessageCommand } from './commands/mark-message.command'
import { RequestWithdrawalCommand } from './commands/request-withdrawal.command'
import {
  type ContactInput,
  SendContactMessageCommand,
} from './commands/send-contact-message.command'
import type {
  ContactMessageFilter,
  ContactMessageRepository,
  ContactMessageSlice,
} from './ports/contact-message.repository.port'
import {
  ADMIN_MESSAGES_PAGE_SIZE,
  ListAdminMessagesQuery,
} from './queries/list-admin-messages.query'

const NOW = new Date('2026-11-04T15:00:00.000Z')
const clock: Clock = { now: () => NOW }

/** Bandeja en memoria con la secuencia de comprobantes. */
class InMemoryMessages implements ContactMessageRepository {
  readonly rows: ContactMessage[] = []
  sequence = 0

  nextWithdrawalNumber(): Promise<number> {
    this.sequence += 1
    return Promise.resolve(this.sequence)
  }

  peekWithdrawalNumber(): Promise<number> {
    return Promise.resolve(this.sequence + 1)
  }

  create(message: NewContactMessage): Promise<void> {
    this.rows.push({
      ...message,
      id: `00000000-0000-7000-8000-${String(this.rows.length + 1).padStart(12, '0')}`,
      createdAt: new Date(NOW.getTime() + this.rows.length * 1000),
      readAt: null,
    })
    return Promise.resolve()
  }

  list(filter: ContactMessageFilter, page: number, pageSize: number): Promise<ContactMessageSlice> {
    const matching = [...this.rows]
      .reverse()
      .filter(
        (row) =>
          (filter.kind === undefined || row.kind === filter.kind) &&
          (filter.read === undefined || (row.readAt !== null) === filter.read),
      )
    const start = (page - 1) * pageSize
    return Promise.resolve({
      items: matching.slice(start, start + pageSize),
      total: matching.length,
    })
  }

  setRead(id: string, read: boolean, now: Date): Promise<ContactMessage | null> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined) return Promise.resolve(null)
    row.readAt = read ? (row.readAt ?? now) : null
    return Promise.resolve(row)
  }
}

/** Registro de los mails que todavía no salen. */
function mailLog(): { lines: string[]; log: (message: string) => void } {
  const lines: string[] = []
  return { lines, log: (message) => lines.push(message) }
}

const CONTACT: ContactInput = {
  name: 'Lucía Gómez',
  email: 'lucia@example.com',
  orderNumber: null,
  reason: 'Envío',
  message: 'Quiero saber cuándo llega mi pedido.',
  website: null,
}

const WITHDRAWAL = {
  name: 'Lucía Gómez',
  email: 'lucia@example.com',
  orderNumber: 'GLP-10001',
  comment: null,
  website: '',
}

describe('formatWithdrawalCode', () => {
  it('arma ARR- con 6 dígitos como mínimo y sigue con más después de 999.999 (NV-12)', () => {
    expect(formatWithdrawalCode(1)).toBe('ARR-000001')
    expect(formatWithdrawalCode(999_999)).toBe('ARR-999999')
    expect(formatWithdrawalCode(1_000_000)).toBe('ARR-1000000')
    expect(formatWithdrawalCode(999_999_999_999)).toBe('ARR-999999999999')
  })

  it('rechaza un número fuera de rango o con decimales', () => {
    expect(() => formatWithdrawalCode(0)).toThrow(RangeError)
    expect(() => formatWithdrawalCode(1_000_000_000_000)).toThrow(RangeError)
    expect(() => formatWithdrawalCode(1.5)).toThrow(RangeError)
  })
})

describe('SendContactMessageCommand', () => {
  it('deja el mensaje sin leer en la bandeja y loguea el mail sin datos personales', async () => {
    const messages = new InMemoryMessages()
    const log = mailLog()

    await new SendContactMessageCommand(messages, log).execute(CONTACT)

    expect(messages.rows).toEqual([
      expect.objectContaining({
        kind: 'contact',
        name: 'Lucía Gómez',
        email: 'lucia@example.com',
        orderNumber: null,
        reason: 'Envío',
        message: 'Quiero saber cuándo llega mi pedido.',
        code: null,
        readAt: null,
      }),
    ])
    expect(log.lines).toHaveLength(1)
    expect(log.lines.join()).not.toMatch(/Lucía|lucia@example\.com|llega mi pedido/)
  })

  it.each(['https://spam.example', ' '])(
    'con el campo trampa lleno (%j) no guarda nada ni loguea',
    async (website) => {
      const messages = new InMemoryMessages()
      const log = mailLog()

      await new SendContactMessageCommand(messages, log).execute({ ...CONTACT, website })

      expect(messages.rows).toEqual([])
      expect(log.lines).toEqual([])
    },
  )
})

describe('RequestWithdrawalCommand', () => {
  it('devuelve ARR-000001 y después ARR-000002, y deja cada uno en la bandeja', async () => {
    const messages = new InMemoryMessages()
    const command = new RequestWithdrawalCommand(messages)

    await expect(command.execute(WITHDRAWAL)).resolves.toEqual({ code: 'ARR-000001' })
    await expect(
      command.execute({ ...WITHDRAWAL, comment: 'Me arrepentí.', orderNumber: null }),
    ).resolves.toEqual({ code: 'ARR-000002' })

    expect(
      messages.rows.map(({ kind, reason, message, code, orderNumber }) => ({
        kind,
        reason,
        message,
        code,
        orderNumber,
      })),
    ).toEqual([
      {
        kind: 'withdrawal',
        reason: null,
        message: null,
        code: 'ARR-000001',
        orderNumber: 'GLP-10001',
      },
      {
        kind: 'withdrawal',
        reason: null,
        message: 'Me arrepentí.',
        code: 'ARR-000002',
        orderNumber: null,
      },
    ])
  })

  it('con el campo trampa lleno responde el código que seguiría, sin consumirlo ni guardar nada (como el mock)', async () => {
    const messages = new InMemoryMessages()
    const log = mailLog()
    const command = new RequestWithdrawalCommand(messages, log)

    for (let i = 0; i < 3; i += 1) {
      await expect(command.execute({ ...WITHDRAWAL, website: 'spam' })).resolves.toEqual({
        code: 'ARR-000001',
      })
    }
    expect(messages.sequence).toBe(0)
    expect(messages.rows).toEqual([])
    expect(log.lines).toEqual([])
    await expect(command.execute(WITHDRAWAL)).resolves.toEqual({ code: 'ARR-000001' })
    expect(log.lines).toEqual([
      'Arrepentimiento ARR-000001 en la bandeja: el comprobante sale por mail.',
    ])
  })

  it('con la secuencia agotada, la trampa igual responde un código válido (no un 500)', async () => {
    const messages = new InMemoryMessages()
    messages.sequence = 999_999_999_999

    await expect(
      new RequestWithdrawalCommand(messages).execute({ ...WITHDRAWAL, website: 'spam' }),
    ).resolves.toEqual({ code: 'ARR-999999999999' })
    expect(messages.sequence).toBe(999_999_999_999)
  })

  it('NV-12: pasado 999.999 los arrepentimientos siguen (antes, RangeError y 500)', async () => {
    const messages = new InMemoryMessages()
    messages.sequence = 999_999

    await expect(new RequestWithdrawalCommand(messages).execute(WITHDRAWAL)).resolves.toEqual({
      code: 'ARR-1000000',
    })
  })
})

describe('ListAdminMessagesQuery y MarkMessageCommand', () => {
  async function inbox(): Promise<InMemoryMessages> {
    const messages = new InMemoryMessages()
    await new SendContactMessageCommand(messages).execute(CONTACT)
    await new RequestWithdrawalCommand(messages).execute(WITHDRAWAL)
    return messages
  }

  it('lista del más nuevo al más viejo, de a 20, con read según read_at', async () => {
    const messages = await inbox()

    const page = await new ListAdminMessagesQuery(messages).execute({}, 1)

    expect(page.pageSize).toBe(ADMIN_MESSAGES_PAGE_SIZE)
    expect(page.total).toBe(2)
    expect(page.items.map((item) => [item.kind, item.read, item.code])).toEqual([
      ['withdrawal', false, 'ARR-000001'],
      ['contact', false, null],
    ])
    expect(page.items[1]?.createdAt).toBe(NOW.toISOString())
  })

  it('filtra por tipo y por leído, y una página fuera de rango viene vacía con el total', async () => {
    const messages = await inbox()
    const query = new ListAdminMessagesQuery(messages)

    expect((await query.execute({ kind: 'contact' }, 1)).items.map((item) => item.kind)).toEqual([
      'contact',
    ])
    expect((await query.execute({ read: true }, 1)).total).toBe(0)
    await expect(query.execute({}, 2)).resolves.toMatchObject({ items: [], page: 2, total: 2 })
    await expect(query.execute({}, 0)).rejects.toThrow(RangeError)
  })

  it('marcar leído dos veces conserva la primera fecha y no leído la borra', async () => {
    const messages = await inbox()
    const id = messages.rows[0]?.id ?? ''
    const later: Clock = { now: () => new Date(NOW.getTime() + 60_000) }

    await expect(new MarkMessageCommand(messages, clock).execute(id, true)).resolves.toMatchObject({
      read: true,
    })
    await new MarkMessageCommand(messages, later).execute(id, true)
    expect(messages.rows[0]?.readAt).toEqual(NOW)

    await expect(new MarkMessageCommand(messages, clock).execute(id, false)).resolves.toMatchObject(
      {
        read: false,
      },
    )
    expect(messages.rows[0]?.readAt).toBeNull()
  })

  it('un mensaje que no existe da MessageNotFoundError (404)', async () => {
    const messages = await inbox()

    const error = await new MarkMessageCommand(messages, clock)
      .execute('no-existe', true)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MessageNotFoundError)
    expect(error).toMatchObject({ status: 404, detail: 'No existe ese mensaje.' })
  })
})
