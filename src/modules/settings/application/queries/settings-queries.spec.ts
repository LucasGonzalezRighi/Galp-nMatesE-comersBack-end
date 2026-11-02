import { describe, expect, it } from 'vitest'

import { createStoreSettings, type StoreSettings } from '../../domain/store-settings.entity'
import type { SettingsRepository } from '../ports/settings.repository.port'
import { GetPublicSettingsQuery } from './get-public-settings.query'
import { GetStoreSettingsQuery } from './get-store-settings.query'

const SELLER = {
  legalName: null,
  cuit: null,
  taxCondition: null,
  address: null,
  phone: null,
  supportArea: null,
  supportHours: null,
  dataFiscalUrl: null,
}

const SETTINGS: StoreSettings = {
  kitDiscountPercent: 10,
  installmentsMax: 3,
  installmentsShowOnProduct: true,
  contactEmail: 'galpon.mates@gmail.com',
  lowStockThreshold: 3,
  vatRatePercent: 21,
  showNetPrice: true,
  seller: SELLER,
  shippingOptions: [
    { method: 'home', label: 'Envío a domicilio', costArs: 6500, eta: '3 a 6 días', enabled: true },
    {
      method: 'branch',
      label: 'Envío a sucursal',
      costArs: 4900,
      eta: '3 a 6 días',
      enabled: true,
    },
    { method: 'pickup', label: 'Retiro', costArs: 0, eta: 'Coordinamos', enabled: true },
  ],
}

const repository: SettingsRepository = { get: () => Promise.resolve(SETTINGS) }

describe('GetPublicSettingsQuery', () => {
  it('devuelve solo lo público, sin la alícuota de IVA ni el umbral de stock bajo', async () => {
    const settings = await new GetPublicSettingsQuery(repository).execute()
    expect(settings).toEqual({
      kitDiscountPercent: 10,
      shippingOptions: SETTINGS.shippingOptions,
      installments: { maxWithoutInterest: 3, showOnProduct: true },
      contactEmail: 'galpon.mates@gmail.com',
      priceDisplay: { showNetPrice: true },
      seller: SELLER,
    })
  })
})

describe('GetStoreSettingsQuery', () => {
  it('devuelve los ajustes completos para los otros módulos', async () => {
    await expect(new GetStoreSettingsQuery(repository).execute()).resolves.toMatchObject({
      vatRatePercent: 21,
      showNetPrice: true,
    })
  })
})

describe('createStoreSettings', () => {
  it('valida los rangos con errores en español', () => {
    expect(createStoreSettings(SETTINGS)).toEqual(SETTINGS)
    expect(() => createStoreSettings({ ...SETTINGS, kitDiscountPercent: 31 })).toThrow(/descuento/)
    expect(() => createStoreSettings({ ...SETTINGS, installmentsMax: 0 })).toThrow(/cuotas/)
    expect(() => createStoreSettings({ ...SETTINGS, vatRatePercent: 101 })).toThrow(/alícuota/)
    expect(() => createStoreSettings({ ...SETTINGS, contactEmail: ' ' })).toThrow(/email/)
  })
})
