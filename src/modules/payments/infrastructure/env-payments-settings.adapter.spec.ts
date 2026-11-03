import { describe, expect, it, vi } from 'vitest'

import type { Env } from '../../../config/env'
import type { StoreSettings } from '../../settings/domain/store-settings.entity'
import { EnvPaymentsSettings, simulatorOrigin } from './env-payments-settings.adapter'

const BASE: Env = {
  NODE_ENV: 'development',
  PORT: 3001,
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
  ADMIN_ORIGIN: 'http://localhost:5173',
  STORE_ORIGIN: 'http://localhost:4300',
  LOG_LEVEL: 'info',
  MP_MODE: 'simulated',
  MP_STATEMENT_DESCRIPTOR: 'GALPON MATES',
}

function settingsWith(env: Env, installmentsMax = 6) {
  const store = {
    execute: vi.fn(() => Promise.resolve({ installmentsMax } as StoreSettings)),
  }
  return { settings: new EnvPaymentsSettings(env, store), store }
}

describe('EnvPaymentsSettings', () => {
  it('en simulado no hay notification_url ni secreto si no se configuró', () => {
    const { settings } = settingsWith(BASE)

    expect(settings).toMatchObject({
      mode: 'simulated',
      notificationUrl: null,
      storeOrigin: 'http://localhost:4300',
      statementDescriptor: 'GALPON MATES',
      webhookSecret: null,
      simulatorOrigin: 'http://localhost:3001',
    })
  })

  it('en live arma la notification_url con PUBLIC_API_ORIGIN y usa el secreto', () => {
    const { settings } = settingsWith({
      ...BASE,
      NODE_ENV: 'production',
      MP_MODE: 'live',
      MP_ACCESS_TOKEN: 'APP_USR-token',
      MP_WEBHOOK_SECRET: 'secreto',
      PUBLIC_API_ORIGIN: 'https://api.galpon.test',
      MP_STATEMENT_DESCRIPTOR: 'GALPON',
    })

    expect(settings).toMatchObject({
      mode: 'live',
      notificationUrl: 'https://api.galpon.test/api/v1/webhooks/mercadopago',
      statementDescriptor: 'GALPON',
      webhookSecret: 'secreto',
      simulatorOrigin: 'https://api.galpon.test',
    })
  })

  it('un secreto configurado en simulado también vale (los E2E firman con él)', () => {
    const { settings } = settingsWith({ ...BASE, MP_WEBHOOK_SECRET: 'secreto-de-prueba' })

    expect(settings.webhookSecret).toBe('secreto-de-prueba')
    expect(settings.notificationUrl).toBeNull()
  })

  it('maxWithoutInterest lee installmentsMax de los ajustes en cada llamada', async () => {
    const { settings, store } = settingsWith(BASE, 6)

    await expect(settings.maxWithoutInterest()).resolves.toBe(6)
    await expect(settings.maxWithoutInterest()).resolves.toBe(6)
    expect(store.execute).toHaveBeenCalledTimes(2)
  })

  it('simulatorOrigin usa PUBLIC_API_ORIGIN o http://localhost:PORT', () => {
    expect(simulatorOrigin({ PORT: 4001 })).toBe('http://localhost:4001')
    expect(simulatorOrigin({ PORT: 4001, PUBLIC_API_ORIGIN: 'https://api.galpon.test' })).toBe(
      'https://api.galpon.test',
    )
  })
})
