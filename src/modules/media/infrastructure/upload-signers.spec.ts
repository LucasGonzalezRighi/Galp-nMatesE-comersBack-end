import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { SignUploadCommand } from '../application/commands/sign-upload.command'
import type { MediaPurpose } from '../domain/media'
import {
  cloudinarySignature,
  CloudinaryUploadSigner,
  createUploadSigner,
  SimulatedUploadSigner,
} from './upload-signers'

const SECRET = 'secreto-de-prueba'

const CREDENTIALS = { cloudName: 'galpon', apiKey: '123456789012345', apiSecret: SECRET }

describe('firma de Cloudinary', () => {
  it('es el sha1 de los parámetros ordenados con el secreto pegado', () => {
    const expected = createHash('sha1')
      .update('folder=galpon/productos&timestamp=1700000000' + SECRET)
      .digest('hex')
    expect(cloudinarySignature({ timestamp: 1700000000, folder: 'galpon/productos' }, SECRET)).toBe(
      expected,
    )
    expect(expected).toMatch(/^[0-9a-f]{40}$/)
  })

  it('rechaza un secreto vacío o sin parámetros', () => {
    expect(() => cloudinarySignature({ folder: 'galpon/sitio' }, ' ')).toThrow(TypeError)
    expect(() => cloudinarySignature({}, SECRET)).toThrow(RangeError)
  })

  it('el firmante de Cloudinary devuelve la clave pública y la nube, nunca el secreto', () => {
    const signed = new CloudinaryUploadSigner(CREDENTIALS).sign('galpon/lineas', 1700000000)
    expect(signed).toEqual({
      timestamp: 1700000000,
      signature: cloudinarySignature({ folder: 'galpon/lineas', timestamp: 1700000000 }, SECRET),
      apiKey: '123456789012345',
      cloudName: 'galpon',
      folder: 'galpon/lineas',
    })
    expect(JSON.stringify(signed)).not.toContain(SECRET)
  })

  it('el firmante de Cloudinary exige las tres credenciales', () => {
    expect(() => new CloudinaryUploadSigner({ ...CREDENTIALS, apiKey: '' })).toThrow(TypeError)
  })

  it('el simulado firma como el mock del front', () => {
    const signed = new SimulatedUploadSigner().sign('galpon/productos', 1700000000)
    expect(signed).toMatchObject({
      timestamp: 1700000000,
      apiKey: 'mock-api-key',
      cloudName: 'galpon-mock',
      folder: 'galpon/productos',
    })
    expect(signed.signature).toMatch(/^mock-[0-9a-f]{40}$/)
  })

  it('el modo elige el firmante', () => {
    expect(createUploadSigner({ MEDIA_MODE: 'simulated' })).toBeInstanceOf(SimulatedUploadSigner)
    const live = createUploadSigner({
      MEDIA_MODE: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'galpon',
      CLOUDINARY_API_KEY: '1',
      CLOUDINARY_API_SECRET: SECRET,
    })
    expect(live).toBeInstanceOf(CloudinaryUploadSigner)
    expect(() => createUploadSigner({ MEDIA_MODE: 'cloudinary' })).toThrow(Error)
  })
})

describe('SignUploadCommand', () => {
  const clock = { now: () => new Date('2023-11-14T22:13:20.999Z') }

  it('firma la carpeta del uso con la hora en segundos', () => {
    const command = new SignUploadCommand(new CloudinaryUploadSigner(CREDENTIALS), clock)
    const signed = command.execute('category')
    expect(signed).toMatchObject({ timestamp: 1700000000, folder: 'galpon/lineas' })
    expect(signed.signature).toBe(
      cloudinarySignature({ folder: 'galpon/lineas', timestamp: 1700000000 }, SECRET),
    )
    expect(command.execute('product').folder).toBe('galpon/productos')
    expect(command.execute('partner').folder).toBe('galpon/socios')
    expect(command.execute('site').folder).toBe('galpon/sitio')
  })

  it('rechaza un uso que no existe', () => {
    const command = new SignUploadCommand(new SimulatedUploadSigner(), clock)
    expect(() => command.execute('avatar' as MediaPurpose)).toThrow(RangeError)
  })
})
