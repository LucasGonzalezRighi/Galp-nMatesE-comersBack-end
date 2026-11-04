import { describe, expect, it } from 'vitest'

import { isHoneypotFilled } from './honeypot'

describe('isHoneypotFilled', () => {
  it('las personas lo dejan en null o vacío', () => {
    expect(isHoneypotFilled(null)).toBe(false)
    expect(isHoneypotFilled('')).toBe(false)
  })

  it('cualquier texto lo llenó un bot, un espacio también (como el mock)', () => {
    for (const website of [' ', 'spam', 'https://spam.example']) {
      expect(isHoneypotFilled(website)).toBe(true)
    }
  })
})
