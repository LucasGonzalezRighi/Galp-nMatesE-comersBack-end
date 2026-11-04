import { describe, expect, it } from 'vitest'

import { MEDIA_CLOUDINARY_MISSING_MESSAGE, mediaCloudName } from './media'

describe('mediaCloudName', () => {
  it('en simulado es la nube del mock, aunque haya una configurada', () => {
    expect(mediaCloudName({ MEDIA_MODE: 'simulated' })).toBe('galpon-mock')
    expect(mediaCloudName({ MEDIA_MODE: 'simulated', CLOUDINARY_CLOUD_NAME: 'galpon-prod' })).toBe(
      'galpon-mock',
    )
  })

  it('con cloudinary es CLOUDINARY_CLOUD_NAME', () => {
    expect(mediaCloudName({ MEDIA_MODE: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'galpon-prod' })).toBe(
      'galpon-prod',
    )
  })

  it('con cloudinary sin nube lanza el mensaje de las variables que faltan', () => {
    expect(() => mediaCloudName({ MEDIA_MODE: 'cloudinary' })).toThrow(
      MEDIA_CLOUDINARY_MISSING_MESSAGE,
    )
  })
})
