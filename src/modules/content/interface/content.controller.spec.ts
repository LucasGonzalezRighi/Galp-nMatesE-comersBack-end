import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { GetContentQuery } from '../application/queries/get-content.query'
import type { ContentKey } from '../domain/content-key'
import { ContentController } from './content.controller'

/** Contenidos cargados en la query en memoria (falta `footer`, a propósito). */
const CONTENTS: Partial<Record<ContentKey, object>> = {
  home: { hero: {} },
  about: { quote: 'Q' },
  faq: { categories: [] },
  'product-tabs': { shipping: 'S' },
  'legal-terms': { title: 'Términos' },
  'legal-privacy': { title: 'Privacidad' },
}

describe('ContentController (HTTP con la query en memoria)', () => {
  const getContent = {
    execute: vi.fn((key: ContentKey) => Promise.resolve(CONTENTS[key] ?? null)),
  }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [ContentController],
      providers: [{ provide: GetContentQuery, useValue: getContent }],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  it.each([
    ['/content/home', 'home'],
    ['/content/about', 'about'],
    ['/content/faq', 'faq'],
    ['/content/product-tabs', 'product-tabs'],
    ['/content/legal/terms', 'legal-terms'],
    ['/content/legal/privacy', 'legal-privacy'],
  ] as const)('%s devuelve el contenido %s', async (path, key) => {
    const response = await request(server()).get(path)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(CONTENTS[key])
  })

  it('un documento legal que no es terms ni privacy responde 404, como dice el contrato', async () => {
    getContent.execute.mockClear()

    const response = await request(server()).get('/content/legal/otro')

    expect(response.status).toBe(404)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toMatchObject({
      type: 'not_found',
      detail: 'No existe ese documento legal.',
    })
    expect(getContent.execute).not.toHaveBeenCalled()
  })

  it('un contenido que falta en la base responde 500 sin mostrar el detalle interno', async () => {
    const response = await request(server()).get('/content/footer')

    expect(response.status).toBe(500)
    expect(response.body).toMatchObject({ type: 'server_error' })
    expect(JSON.stringify(response.body)).not.toContain('content_blocks')
  })
})
