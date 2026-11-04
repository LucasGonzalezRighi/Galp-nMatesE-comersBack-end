import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Pedido que recibió la tienda falsa. */
export interface FakeStoreRequest {
  /** Método HTTP (el aviso es `POST`). */
  method: string
  /** Ruta pedida (el aviso es `/api/revalidate`). */
  url: string
  /** Cabeceras (el secreto va en `x-revalidate-secret`). */
  headers: IncomingHttpHeaders
  /** Cuerpo tal cual llegó, por ejemplo `{"tags":["products","combos"]}`. */
  body: string
}

/** Tienda falsa que escucha en `127.0.0.1` y anota cada `POST /api/revalidate` que le llega. */
export interface FakeStore {
  /** Origen para `STORE_ORIGIN`, por ejemplo `http://127.0.0.1:53123`. */
  origin: string
  /** Lo que recibió, en orden de llegada (vaciala con `requests.length = 0`). */
  requests: FakeStoreRequest[]
  /** Estados que va a responder, en orden (sacados con `shift`; sin ninguno, 200). */
  script: number[]
  /**
   * Etiquetas de cada pedido recibido, en orden.
   *
   * @returns Una lista por pedido; `[]` si el cuerpo no trae `tags`.
   */
  tags(): string[][]
  /** Corta las conexiones abiertas y deja de escuchar. */
  close(): Promise<void>
}

/**
 * Etiquetas del cuerpo de un aviso.
 *
 * @param body - Cuerpo recibido.
 * @returns Las de `tags`, o `[]` si el cuerpo no es un JSON con esa lista.
 */
function tagsOf(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || !('tags' in parsed)) return []
    const { tags } = parsed
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

/**
 * Levanta la tienda falsa en un puerto libre de `127.0.0.1` (la de `test/e2e/combos.e2e-spec.ts`,
 * reusable). Responde lo que diga `script` (200 si está vacío) con un JSON y anota cada pedido.
 *
 * Uso típico: `const store = await startFakeStore()`, después `STORE_ORIGIN = store.origin` y
 * `STORE_REVALIDATE_SECRET` (32 caracteres o más) antes de `createApp()`; publicar el outbox con
 * `app.get(OutboxRelay).runOnce()` y esperar con `vi.waitFor` a que `store.tags()` traiga lo
 * esperado; al final, `await store.close()`.
 *
 * @returns La tienda escuchando.
 */
export async function startFakeStore(): Promise<FakeStore> {
  const requests: FakeStoreRequest[] = []
  const script: number[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const { method = '', url = '', headers } = request
      requests.push({ method, url, headers, body })
      const status = script.shift() ?? 200
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(
          status === 200 ? { revalidated: tagsOf(body) } : { error: 'Falla programada' },
        ),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    script,
    tags: () => requests.map(({ body }) => tagsOf(body)),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    },
  }
}
