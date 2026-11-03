import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpStorefrontAdapter, STOREFRONT_TIMEOUT_MS } from './http-storefront.adapter'

const SECRET = 's3cr3t-de-la-tienda-0123456789abcdef'
const STORE_ORIGIN = 'http://127.0.0.1:4310'

/** `fetch` falso que devuelve `response` (o lanza `error`) y guarda lo que recibió. */
function fakeFetch(answer: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  )
}

function adapterWith(answer: Response | Error, secret: string | null = SECRET) {
  const fetchFn = fakeFetch(answer)
  const adapter = new HttpStorefrontAdapter({
    storeOrigin: STORE_ORIGIN,
    secret: secret ?? undefined,
    fetch: fetchFn,
  })
  return { adapter, fetchFn }
}

/** Texto de la URL que recibió el `fetch` falso. */
function hrefOf(input: unknown): string {
  return input instanceof URL ? input.href : typeof input === 'string' ? input : ''
}

/** Mensaje del error con que se rechaza `promise`, o falla si se resuelve. */
async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('no lanzó')
}

describe('HttpStorefrontAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hace POST a /api/revalidate con el secreto en la cabecera y las etiquetas en el cuerpo', async () => {
    const { adapter, fetchFn } = adapterWith(
      Response.json({ revalidated: ['combos'] }, { status: 200 }),
    )

    await adapter.revalidate(['combos'])

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] ?? []
    expect(url).toBeInstanceOf(URL)
    expect(hrefOf(url)).toBe(`${STORE_ORIGIN}/api/revalidate`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      'x-revalidate-secret': SECRET,
    })
    expect(init?.body).toBe('{"tags":["combos"]}')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(STOREFRONT_TIMEOUT_MS).toBe(5_000)
  })

  it('un STORE_ORIGIN con ruta igual le pega a /api/revalidate del origen', async () => {
    const fetchFn = fakeFetch(new Response(null, { status: 204 }))
    const adapter = new HttpStorefrontAdapter({
      storeOrigin: `${STORE_ORIGIN}/algo/`,
      secret: SECRET,
      fetch: fetchFn,
    })

    await adapter.revalidate(['combos'])

    expect(hrefOf(fetchFn.mock.calls[0]?.[0])).toBe(`${STORE_ORIGIN}/api/revalidate`)
  })

  it.each([200, 204])('%i → revalidated con las etiquetas pedidas', async (status) => {
    const body = status === 204 ? null : JSON.stringify({ revalidated: ['combos'] })
    const { adapter } = adapterWith(new Response(body, { status }))

    await expect(adapter.revalidate(['combos'])).resolves.toEqual({
      kind: 'revalidated',
      tags: ['combos'],
    })
  })

  it.each([
    [401, 'El secreto de revalidación no es válido.'],
    [422, 'La etiqueta "combos" no es válida.'],
  ])('%i → rejected con el error del cuerpo', async (status, error) => {
    const { adapter } = adapterWith(Response.json({ error }, { status }))

    await expect(adapter.revalidate(['combos'])).resolves.toEqual({
      kind: 'rejected',
      status,
      reason: error,
    })
  })

  it('un 4xx sin JSON se rechaza con un motivo genérico', async () => {
    const { adapter } = adapterWith(new Response('<html>no</html>', { status: 404 }))

    await expect(adapter.revalidate(['combos'])).resolves.toEqual({
      kind: 'rejected',
      status: 404,
      reason: 'La tienda respondió 404.',
    })
  })

  it.each([500, 503, 408, 429])('%i → lanza (BullMQ reintenta)', async (status) => {
    const { adapter } = adapterWith(Response.json({ error: 'caída' }, { status }))

    expect(await errorOf(adapter.revalidate(['combos']))).toContain(String(status))
  })

  it('un error de red lanza', async () => {
    const { adapter } = adapterWith(new TypeError('fetch failed'))

    expect(await errorOf(adapter.revalidate(['combos']))).toContain('fetch failed')
  })

  it('el timeout lanza', async () => {
    const { adapter } = adapterWith(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    )

    expect(await errorOf(adapter.revalidate(['combos']))).toContain('5 s')
  })

  it('nunca pone el secreto en un log ni en un error', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    )
    const answers = [
      Response.json({ revalidated: ['combos'] }),
      Response.json({ error: 'El secreto de revalidación no es válido.' }, { status: 401 }),
      Response.json({ error: 'caída' }, { status: 500 }),
      new TypeError('fetch failed'),
    ]
    const messages: string[] = []
    for (const answer of answers) {
      const { adapter } = adapterWith(answer)
      messages.push(
        await adapter.revalidate(['combos']).then(
          (result) => JSON.stringify(result),
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      )
    }

    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect([...messages, ...logged].some((text) => text.includes(SECRET))).toBe(false)
  })

  it('valida las etiquetas antes de llamar a la tienda', async () => {
    const { adapter, fetchFn } = adapterWith(new Response(null, { status: 204 }))

    await expect(adapter.revalidate([])).rejects.toThrow(RangeError)
    await expect(adapter.revalidate(['../x'])).rejects.toThrow('no es válida')
    await expect(adapter.revalidate(Array.from({ length: 51 }, () => 'combos'))).rejects.toThrow(
      RangeError,
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('sin secreto no llama a la tienda', async () => {
    const { adapter, fetchFn } = adapterWith(new Response(null, { status: 204 }), null)

    await expect(adapter.revalidate(['combos'])).rejects.toThrow('STORE_REVALIDATE_SECRET')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
