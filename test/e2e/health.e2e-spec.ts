import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../support/app'

describe('health', () => {
  it('GET /api/v1/health responde 200 con status ok', async () => {
    const app = await createApp()
    const res = await request(app.getHttpServer()).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok' })
    await app.close()
  })
})
