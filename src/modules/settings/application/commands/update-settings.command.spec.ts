import { describe, expect, it } from 'vitest'

import type { StoreSettings } from '../../domain/store-settings.entity'
import { roundVatRatePercent } from '../../domain/store-settings.entity'
import type {
  SettingsChanges,
  SettingsRepository,
  SettingsWrite,
} from '../ports/settings.repository.port'
import { type AdminSettingsInput, UpdateSettingsCommand } from './update-settings.command'

const ADMIN = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

const SELLER = {
  legalName: 'Galpón Mates SRL',
  cuit: '20123456786',
  taxCondition: null,
  address: null,
  phone: null,
  supportArea: null,
  supportHours: null,
  dataFiscalUrl: null,
}

/** Lo que manda el dashboard: envíos dados vuelta y con otro nombre (que se ignora). */
const INPUT: AdminSettingsInput = {
  kitDiscountPercent: 15,
  shippingOptions: [
    { method: 'pickup', costArs: 0, eta: 'Coordinamos', enabled: false },
    { method: 'branch', costArs: 3200, eta: '4 a 6 días', enabled: true },
    { method: 'home', costArs: 4500, eta: '3 a 5 días', enabled: true },
  ],
  installments: { maxWithoutInterest: 6, showOnProduct: true },
  contactEmail: 'hola@galponmates.com.ar',
  lowStockThreshold: 3,
  vatRatePercent: 10.555,
  priceDisplay: { showNetPrice: true },
  seller: SELLER,
  consumerLinks: { cabaUrl: 'https://caba.example/defensa', nationalUrl: 'https://nacion.example' },
}

/** Repositorio en memoria: conserva el `label` guardado de cada envío y anota cada guardado. */
function memorySettings() {
  const labels = { home: 'Envío a domicilio', branch: 'Envío a sucursal', pickup: 'Retiro' }
  const saved: { changes: SettingsChanges; write: SettingsWrite }[] = []
  const settings: Pick<SettingsRepository, 'save'> = {
    save: (changes, write) => {
      saved.push({ changes, write })
      const stored: StoreSettings = {
        ...changes,
        shippingOptions: changes.shippingOptions.map((option) => ({
          ...option,
          label: labels[option.method],
        })),
      }
      return Promise.resolve(stored)
    },
  }
  return { settings, saved }
}

describe('UpdateSettingsCommand', () => {
  it('guarda con un solo storefront.stale (settings, products, combos) y los envíos en orden', async () => {
    const { settings, saved } = memorySettings()
    const result = await new UpdateSettingsCommand(settings).execute(INPUT, ADMIN)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.write).toEqual({
      updatedBy: ADMIN,
      event: {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'settings.updated',
        payload: { reason: 'settings.updated', tags: ['settings', 'products', 'combos'] },
      },
    })
    expect(saved[0]?.changes.shippingOptions.map(({ method }) => method)).toEqual([
      'home',
      'branch',
      'pickup',
    ])
    expect(result.shippingOptions).toEqual([
      {
        method: 'home',
        label: 'Envío a domicilio',
        costArs: 4500,
        eta: '3 a 5 días',
        enabled: true,
      },
      {
        method: 'branch',
        label: 'Envío a sucursal',
        costArs: 3200,
        eta: '4 a 6 días',
        enabled: true,
      },
      { method: 'pickup', label: 'Retiro', costArs: 0, eta: 'Coordinamos', enabled: false },
    ])
    expect(result).toMatchObject({
      kitDiscountPercent: 15,
      installments: { maxWithoutInterest: 6, showOnProduct: true },
      priceDisplay: { showNetPrice: true },
      lowStockThreshold: 3,
      vatRatePercent: 10.56,
      seller: SELLER,
      consumerLinks: INPUT.consumerLinks,
    })
    expect(saved[0]?.changes.consumerLinks).toEqual(INPUT.consumerLinks)
  })

  it('dos envíos, un método repetido, un valor fuera de rango o sin admin no guarda nada', async () => {
    const { settings, saved } = memorySettings()
    const command = new UpdateSettingsCommand(settings)
    const [pickup, branch] = INPUT.shippingOptions
    if (pickup === undefined || branch === undefined) throw new Error('Faltan envíos')
    await expect(
      command.execute({ ...INPUT, shippingOptions: [pickup, branch] }, ADMIN),
    ).rejects.toThrow(RangeError)
    await expect(
      command.execute({ ...INPUT, shippingOptions: [pickup, branch, branch] }, ADMIN),
    ).rejects.toThrow('una por método')
    await expect(command.execute({ ...INPUT, kitDiscountPercent: 31 }, ADMIN)).rejects.toThrow(
      RangeError,
    )
    await expect(command.execute(INPUT, ' ')).rejects.toThrow(TypeError)
    expect(saved).toEqual([])
  })
})

describe('roundVatRatePercent', () => {
  it('redondea a 2 decimales con las mitades hacia arriba', () => {
    expect(roundVatRatePercent(10.555)).toBe(10.56)
    expect(roundVatRatePercent(10.5)).toBe(10.5)
    expect(roundVatRatePercent(21)).toBe(21)
    expect(roundVatRatePercent(1.005)).toBe(1.01)
    expect(roundVatRatePercent(0.0000001)).toBe(0)
    expect(roundVatRatePercent(99.999)).toBe(100)
  })

  it('fuera de 0 a 100 lanza en español', () => {
    expect(() => roundVatRatePercent(-1)).toThrow('entre 0 y 100')
    expect(() => roundVatRatePercent(Number.NaN)).toThrow(RangeError)
  })
})
