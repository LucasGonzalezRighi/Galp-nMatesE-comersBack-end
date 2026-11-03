import { describe, expect, it } from 'vitest'

import {
  COMBO_AGGREGATE,
  COMBO_CHANGED_EVENT,
  type ComboChange,
  comboChangedEvent,
} from './combo-events'

const COMBO_ID = '0192f0c4-7a1e-7c3b-9d2a-5e8f1a2b3c4d'

describe('comboChangedEvent', () => {
  it.each<ComboChange>(['created', 'updated', 'deleted'])(
    'arma combo.changed %s con el id del combo como agregado',
    (change) => {
      expect(comboChangedEvent(change, COMBO_ID)).toEqual({
        type: COMBO_CHANGED_EVENT,
        aggregateType: COMBO_AGGREGATE,
        aggregateId: COMBO_ID,
        payload: { comboId: COMBO_ID, change },
      })
    },
  )

  it('el reordenamiento va sin combo y con el agregado "combos"', () => {
    expect(comboChangedEvent('reordered', null)).toEqual({
      type: 'combo.changed',
      aggregateType: 'combo',
      aggregateId: 'combos',
      payload: { comboId: null, change: 'reordered' },
    })
  })

  it('rechaza un cambio desconocido o un id vacío', () => {
    expect(() => comboChangedEvent('archived' as ComboChange, COMBO_ID)).toThrow(RangeError)
    expect(() => comboChangedEvent('updated', '  ')).toThrow(TypeError)
  })

  it('created, updated y deleted necesitan el id del combo', () => {
    expect(() => comboChangedEvent('updated', null)).toThrow('necesita el id del combo')
  })
})
