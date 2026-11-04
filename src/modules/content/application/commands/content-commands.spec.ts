import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../../../../shared/domain/domain-event'
import { ContentValidationError } from '../../domain/content-errors'
import type { ContentKey } from '../../domain/content-key'
import type { ContentRepository, ContentWrite } from '../ports/content.repository.port'
import type { AboutContent, FooterContent, LegalContent, ProductTabsContent } from '../read-models'
import { type AboutContentInput, UpdateAboutContentCommand } from './update-about-content.command'
import { UpdateContentCommand } from './update-content.command'

const ADMIN = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

interface Saved {
  key: ContentKey
  data: JsonObject
  write: ContentWrite
}

/** Repositorio en memoria que anota cada guardado. */
function memoryContents(initial: Partial<Record<ContentKey, unknown>> = {}) {
  const data = new Map<ContentKey, unknown>(Object.entries(initial) as [ContentKey, unknown][])
  const saved: Saved[] = []
  const contents: ContentRepository = {
    find: (key) => Promise.resolve(data.get(key) ?? null),
    save: (key, value, write) => {
      saved.push({ key, data: value, write })
      data.set(key, value)
      return Promise.resolve()
    },
  }
  return { contents, saved }
}

const FOOTER: FooterContent = {
  tagline: 'Mates de verdad',
  text: 'Hechos a mano en el galpón.',
  paymentMethods: ['Visa'],
  consumerDefenseUrl: null,
}

const LEGAL: LegalContent = { title: 'Términos', updatedAt: '2026-11-04', body: 'Texto.' }

const TAB = {
  descriptionNote: null,
  materialsTitle: 'Materiales',
  materials: 'Calabaza.',
  careTitle: 'Cuidado',
  care: 'Secalo.',
}

const TABS: ProductTabsContent = { mate: TAB, bombilla: TAB, yerba: TAB, shipping: 'Envíos' }

/** El evento `storefront.stale` que se espera para unas etiquetas. */
const staleEvent = (tags: string[]) => ({
  type: 'storefront.stale',
  aggregateType: 'storefront',
  aggregateId: 'content.updated',
  payload: { reason: 'content.updated', tags },
})

describe('UpdateContentCommand', () => {
  it('guarda el contenido con un solo storefront.stale de su clave y quién lo editó', async () => {
    const { contents, saved } = memoryContents()
    const result = await new UpdateContentCommand(contents).execute('footer', FOOTER, ADMIN)
    expect(result).toEqual(FOOTER)
    expect(saved).toEqual([
      {
        key: 'footer',
        data: FOOTER,
        write: { updatedBy: ADMIN, event: staleEvent(['content:footer']) },
      },
    ])
  })

  it('las pestañas de la ficha suman products; un legal avisa su documento', async () => {
    const { contents, saved } = memoryContents()
    const command = new UpdateContentCommand(contents)
    await command.execute('legal-terms', LEGAL, ADMIN)
    await command.execute('product-tabs', TABS, ADMIN)
    expect(saved.map(({ write }) => write.event)).toEqual([
      staleEvent(['content:legal-terms']),
      staleEvent(['content:product-tabs', 'products']),
    ])
  })

  it('una clave que no es suya, un contenido que no es un objeto o sin admin no guarda nada', async () => {
    const { contents, saved } = memoryContents()
    const command = new UpdateContentCommand(contents)
    await expect(command.execute('about' as never, FOOTER as never, ADMIN)).rejects.toThrow(
      RangeError,
    )
    await expect(command.execute('nope' as never, FOOTER as never, ADMIN)).rejects.toThrow(
      RangeError,
    )
    await expect(command.execute('footer', [] as never, ADMIN)).rejects.toThrow(TypeError)
    await expect(command.execute('footer', FOOTER, ' ')).rejects.toThrow(TypeError)
    expect(saved).toEqual([])
  })
})

describe('UpdateAboutContentCommand', () => {
  const STORED_PHOTO = {
    publicId: 'galpon/socios/bruno',
    url: 'https://cdn.galpon.test/bruno.jpg',
    width: 800,
    height: 800,
    alt: 'Bruno',
  }
  const CURRENT: AboutContent = {
    hero: { eyebrow: 'Nosotros', titleLines: ['Dos socios.'], text: 'Texto.' },
    partners: [{ name: 'Bruno', role: 'Socio', photo: STORED_PHOTO }],
    quote: 'Frase.',
    stepsEyebrow: 'Cómo trabajamos',
    steps: [
      { title: 'Uno', text: 'Paso uno.' },
      { title: 'Dos', text: 'Paso dos.' },
      { title: 'Tres', text: 'Paso tres.' },
    ],
    ctaLabel: 'Conocé la tienda',
  }
  const input = (partners: AboutContentInput['partners']): AboutContentInput => ({
    ...CURRENT,
    partners,
  })

  it('la foto que ya estaba conserva su url y una nueva de galpon/socios/ arma la de la nube', async () => {
    const { contents, saved } = memoryContents({ about: CURRENT })
    const about = await new UpdateAboutContentCommand(contents, 'galpon-mock').execute(
      input([
        { name: 'Bruno', role: 'Socio', photo: { ...STORED_PHOTO, alt: 'Bruno en el taller' } },
        {
          name: 'Lucas',
          role: 'Socio',
          photo: { publicId: 'galpon/socios/lucas', width: 900, height: 1200, alt: 'Lucas' },
        },
        { name: 'Sin foto', role: 'Socio', photo: null },
      ]),
      ADMIN,
    )
    expect(about.partners.map(({ photo }) => photo)).toEqual([
      { ...STORED_PHOTO, alt: 'Bruno en el taller' },
      {
        publicId: 'galpon/socios/lucas',
        url: 'https://res.cloudinary.com/galpon-mock/image/upload/galpon/socios/lucas',
        width: 900,
        height: 1200,
        alt: 'Lucas',
      },
      null,
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0]?.data).toEqual(about)
    expect(saved[0]?.write).toEqual({ updatedBy: ADMIN, event: staleEvent(['content:about']) })
  })

  it('una foto de otra carpeta da 422 en partners.N.photo.publicId y no guarda nada', async () => {
    const { contents, saved } = memoryContents({ about: CURRENT })
    const error: unknown = await new UpdateAboutContentCommand(contents, 'galpon-mock')
      .execute(
        input([
          { name: 'Bruno', role: 'Socio', photo: null },
          {
            name: 'Lucas',
            role: 'Socio',
            photo: { publicId: 'galpon/productos/mate', width: 800, height: 800, alt: 'Mate' },
          },
        ]),
        ADMIN,
      )
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ContentValidationError)
    expect((error as ContentValidationError).errors).toEqual([
      {
        field: 'partners.1.photo.publicId',
        code: 'unknown_image',
        message: 'La foto no existe: subila de nuevo',
      },
    ])
    expect(saved).toEqual([])
  })

  it('sin Nosotros guardado igual resuelve las fotos nuevas', async () => {
    const { contents, saved } = memoryContents()
    await new UpdateAboutContentCommand(contents, 'galpon-mock').execute(
      input([{ name: 'Lucas', role: 'Socio', photo: null }]),
      ADMIN,
    )
    expect(saved).toHaveLength(1)
  })

  it('sin nube no se puede armar', () => {
    expect(() => new UpdateAboutContentCommand(memoryContents().contents, ' ')).toThrow(TypeError)
  })
})
