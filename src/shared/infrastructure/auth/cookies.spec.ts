import { describe, expect, it } from 'vitest'

import {
  ADMIN_SESSION_COOKIE,
  clearedSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  readSessionCookie,
  sessionCookie,
} from './cookies'

describe('cookies de sesión', () => {
  it('arma la cookie del cliente con los atributos exactos del contrato', () => {
    expect(sessionCookie(CUSTOMER_SESSION_COOKIE, 'abc', 2_592_000)).toBe(
      '__Host-galpon_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000',
    )
  })

  it('borra la cookie del admin con valor vacío y Max-Age=0', () => {
    expect(clearedSessionCookie(ADMIN_SESSION_COOKIE)).toBe(
      '__Host-galpon_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    )
  })

  it('rechaza un Max-Age que no es un entero positivo', () => {
    expect(() => sessionCookie(CUSTOMER_SESSION_COOKIE, 'abc', 0)).toThrow(/Max-Age/)
    expect(() => sessionCookie(CUSTOMER_SESSION_COOKIE, 'abc', 1.5)).toThrow(/Max-Age/)
  })

  it('rechaza un valor con caracteres que rompen la cookie', () => {
    expect(() => sessionCookie(CUSTOMER_SESSION_COOKIE, 'a;b', 60)).toThrow(/valor/)
  })

  it('lee la cookie de req.cookies (cookie-parser)', () => {
    const req = { headers: {}, cookies: { [CUSTOMER_SESSION_COOKIE]: 'abc' } }

    expect(readSessionCookie(req, CUSTOMER_SESSION_COOKIE)).toBe('abc')
    expect(readSessionCookie(req, ADMIN_SESSION_COOKIE)).toBeNull()
  })

  it('sin cookie-parser, la lee del header Cookie', () => {
    const req = { headers: { cookie: `otra=1; ${ADMIN_SESSION_COOKIE}=f00d; x=y` } }

    expect(readSessionCookie(req, ADMIN_SESSION_COOKIE)).toBe('f00d')
    expect(readSessionCookie(req, CUSTOMER_SESSION_COOKIE)).toBeNull()
    expect(readSessionCookie({ headers: {} }, CUSTOMER_SESSION_COOKIE)).toBeNull()
  })

  it('trata una cookie vacía como ausente', () => {
    const req = { headers: { cookie: `${CUSTOMER_SESSION_COOKIE}=` } }

    expect(readSessionCookie(req, CUSTOMER_SESSION_COOKIE)).toBeNull()
  })
})
