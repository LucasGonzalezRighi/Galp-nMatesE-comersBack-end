// Generado por scripts/import-fixtures.mjs desde las fixtures del front: no editar a mano.
import type { SeedSettings, SeedShippingOption } from './types'

/** Ajustes de la tienda (fila `id = 1`). */
export const SEED_SETTINGS: SeedSettings = {
  kitDiscountPercent: 10,
  installmentsMax: 3,
  installmentsShowOnProduct: true,
  contactEmail: 'galpon.mates@gmail.com',
  lowStockThreshold: 3,
  vatRatePercent: 21,
  showNetPrice: true,
  seller: {
    legalName: null,
    cuit: null,
    taxCondition: null,
    address: null,
    phone: null,
    supportArea: null,
    supportHours: null,
    dataFiscalUrl: null,
  },
}

/** Opciones de envío del checkout, en el orden en que se muestran. */
export const SEED_SHIPPING_OPTIONS: readonly SeedShippingOption[] = [
  {
    method: 'home',
    label: 'Envío a domicilio',
    costArs: 6500,
    eta: '3 a 6 días hábiles',
    enabled: true,
  },
  {
    method: 'branch',
    label: 'Envío a sucursal',
    costArs: 4900,
    eta: '3 a 6 días hábiles',
    enabled: true,
  },
  {
    method: 'pickup',
    label: 'Retiro en persona',
    costArs: 0,
    eta: 'Coordinamos por mail',
    enabled: true,
  },
]
