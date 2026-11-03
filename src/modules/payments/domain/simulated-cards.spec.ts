import { describe, expect, it } from 'vitest'

import {
  newSimulatedPaymentId,
  parseSimulatedToken,
  SIMULATED_TOKEN_PATTERN,
  simulatedOutcome,
  simulatorOutcome,
} from './simulated-cards'

const HEX = '0123456789abcdef0123456789abcdef'

describe('parseSimulatedToken', () => {
  it('lee el titular y los últimos 4 de un token sim_', () => {
    expect(parseSimulatedToken(`sim_APRO_3704_${HEX}`)).toEqual({
      holder: 'APRO',
      lastFour: '3704',
    })
    expect(parseSimulatedToken(`sim_3DS_xxxx_${HEX}`)).toEqual({ holder: '3DS', lastFour: null })
  })

  it.each([
    '',
    `sim_apro_3704_${HEX}`,
    `sim_APRO_370_${HEX}`,
    `sim_APRO_3704_${HEX.toUpperCase()}`,
    `sim_APRO_3704_${HEX}0`,
    '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d',
  ])('%s no es un token simulado', (token) => {
    expect(SIMULATED_TOKEN_PATTERN.test(token)).toBe(false)
    expect(parseSimulatedToken(token)).toBeNull()
  })
})

describe('simulatedOutcome (Ruling B-55)', () => {
  it.each([
    ['APRO', 'approved', 'accredited'],
    ['CONT', 'pending', 'pending_contingency'],
    ['OTHE', 'rejected', 'cc_rejected_other_reason'],
    ['FUND', 'rejected', 'cc_rejected_insufficient_amount'],
    ['SECU', 'rejected', 'cc_rejected_bad_filled_security_code'],
    ['EXPI', 'rejected', 'cc_rejected_bad_filled_date'],
    ['CALL', 'rejected', 'cc_rejected_call_for_authorize'],
    ['3DS', 'pending', 'pending_challenge'],
    ['XXXX', 'rejected', 'cc_rejected_other_reason'],
    [' apro ', 'approved', 'accredited'],
  ])('%s → %s / %s', (holder, status, statusDetail) => {
    expect(simulatedOutcome(holder)).toEqual({ status, statusDetail })
  })
})

describe('simulatorOutcome', () => {
  it.each([
    ['approved', 'approved', 'accredited'],
    ['pending', 'pending', 'pending_waiting_payment'],
    ['rejected', 'rejected', 'cc_rejected_other_reason'],
    ['challenge_ok', 'approved', 'accredited'],
    ['challenge_failed', 'rejected', 'cc_rejected_3ds_challenge'],
  ] as const)('%s → %s / %s', (result, status, statusDetail) => {
    expect(simulatorOutcome(result)).toEqual({ status, statusDetail })
  })
})

describe('newSimulatedPaymentId', () => {
  it('da 10 dígitos', () => {
    expect(newSimulatedPaymentId(() => 0)).toBe('1000000000')
    expect(newSimulatedPaymentId(() => 0.999999999999)).toMatch(/^9\d{9}$/)
    expect(newSimulatedPaymentId()).toMatch(/^[1-9]\d{9}$/)
  })
})
