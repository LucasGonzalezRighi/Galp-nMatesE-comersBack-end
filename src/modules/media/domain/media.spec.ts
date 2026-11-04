import { describe, expect, it } from 'vitest'

import {
  MEDIA_FOLDERS,
  MEDIA_PURPOSES,
  mediaUrl,
  resolveImage,
  SIMULATED_CLOUD_NAME,
  UNKNOWN_IMAGE_MESSAGE,
  type MediaImage,
} from './media'

const STORED: MediaImage = {
  publicId: 'galpon/socios/bruno',
  url: 'https://cdn.galpon.test/bruno.jpg',
  width: 800,
  height: 800,
  alt: 'Bruno en el galpón',
}

const rule = (stored: readonly MediaImage[] = []) => ({
  purpose: 'partner' as const,
  stored,
  cloudName: SIMULATED_CLOUD_NAME,
  field: 'partners.0.photo',
})

describe('media', () => {
  it('tiene una carpeta por uso, como el front', () => {
    expect(MEDIA_PURPOSES).toEqual(['product', 'category', 'partner', 'site'])
    expect(MEDIA_FOLDERS).toEqual({
      product: 'galpon/productos',
      category: 'galpon/lineas',
      partner: 'galpon/socios',
      site: 'galpon/sitio',
    })
  })

  it('mediaUrl arma la URL de Cloudinary con la nube y el publicId', () => {
    expect(mediaUrl('galpon-mock', 'galpon/socios/lucas')).toBe(
      'https://res.cloudinary.com/galpon-mock/image/upload/galpon/socios/lucas',
    )
    expect(() => mediaUrl('', 'galpon/socios/lucas')).toThrow(TypeError)
    expect(() => mediaUrl('galpon-mock', ' ')).toThrow(TypeError)
  })

  it('la foto que ya estaba conserva su url, con las medidas y el alt nuevos', () => {
    const result = resolveImage(
      { publicId: STORED.publicId, width: 900, height: 1200, alt: 'Bruno' },
      rule([STORED]),
    )
    expect(result).toEqual({
      ok: true,
      image: { publicId: STORED.publicId, url: STORED.url, width: 900, height: 1200, alt: 'Bruno' },
    })
  })

  it('una foto nueva en la carpeta de su uso arma la url con la nube', () => {
    const result = resolveImage(
      { publicId: 'galpon/socios/lucas', width: 800, height: 800, alt: 'Lucas' },
      rule([STORED]),
    )
    expect(result).toEqual({
      ok: true,
      image: {
        publicId: 'galpon/socios/lucas',
        url: 'https://res.cloudinary.com/galpon-mock/image/upload/galpon/socios/lucas',
        width: 800,
        height: 800,
        alt: 'Lucas',
      },
    })
  })

  it('una foto de otra carpeta (o la carpeta sola) da unknown_image en {field}.publicId', () => {
    for (const publicId of [
      'galpon/productos/mate',
      'galpon/socios',
      'galpon/socios/',
      'galpon/sociosx/a',
    ]) {
      expect(resolveImage({ publicId, width: 800, height: 800, alt: 'Mate' }, rule())).toEqual({
        ok: false,
        error: {
          field: 'partners.0.photo.publicId',
          code: 'unknown_image',
          message: UNKNOWN_IMAGE_MESSAGE,
        },
      })
    }
    expect(UNKNOWN_IMAGE_MESSAGE).toBe('La foto no existe: subila de nuevo')
  })

  it('rechaza un uso desconocido o un campo vacío con un error en español', () => {
    const input = { publicId: 'galpon/socios/lucas', width: 800, height: 800, alt: 'Lucas' }
    expect(() =>
      resolveImage(input, { ...rule(), purpose: 'banner' as unknown as 'partner' }),
    ).toThrow(RangeError)
    expect(() => resolveImage(input, { ...rule(), field: '' })).toThrow(TypeError)
  })
})
