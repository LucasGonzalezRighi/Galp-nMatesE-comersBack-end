import { describe, expect, it } from 'vitest'

import { Argon2PasswordHasher } from './argon2-password.hasher'

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher()

  it('hashea con argon2id (19 MiB, 2 pasadas, 1 hilo) y nunca devuelve el texto', async () => {
    const hash = await hasher.hash('galpon-demo-2026')

    expect(hash).not.toContain('galpon-demo-2026')
    expect(hash).toMatch(/^\$argon2id\$v=19\$/)
    expect(hash).toContain('m=19456')
    expect(hash).toContain('t=2')
    expect(hash).toContain('p=1')
  })

  it('cada hash lleva su propia sal', async () => {
    expect(await hasher.hash('misma-clave')).not.toBe(await hasher.hash('misma-clave'))
  })

  it('verify da true con la contraseña correcta y false con otra', async () => {
    const hash = await hasher.hash('galpon-demo-2026')

    await expect(hasher.verify(hash, 'galpon-demo-2026')).resolves.toBe(true)
    await expect(hasher.verify(hash, 'otra-clave-2026')).resolves.toBe(false)
  })

  it('verify da false ante un hash malformado o vacío en vez de lanzar', async () => {
    await expect(hasher.verify('no-es-un-hash', 'x')).resolves.toBe(false)
    await expect(hasher.verify('', 'x')).resolves.toBe(false)
  })

  it('hash rechaza una contraseña vacía', async () => {
    await expect(hasher.hash('')).rejects.toThrow('La contraseña no puede estar vacía')
  })
})
