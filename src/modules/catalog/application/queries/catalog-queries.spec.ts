import { describe, expect, it } from 'vitest'

import type { CategoryListing, CategoryRepository } from '../ports/category.repository.port'
import type { PriceDisplay, PriceDisplayPort } from '../ports/price-display.port'
import type {
  ProductFilter,
  ProductList,
  ProductRepository,
} from '../ports/product.repository.port'
import type { ProductTabsPort, ProductTabsTexts } from '../ports/product-tabs.port'
import { Product, type ProductProps } from '../../domain/product.entity'
import { GetProductQuery } from './get-product.query'
import { GetRelatedProductsQuery } from './get-related-products.query'
import { ListCategoriesQuery } from './list-categories.query'
import { ListProductsQuery } from './list-products.query'

const IMPERIALES = { id: 'c1', slug: 'imperiales', name: 'Imperiales', group: 'mate' } as const
const TORPEDOS = { id: 'c2', slug: 'torpedos', name: 'Torpedos', group: 'mate' } as const
const YERBAS = { id: 'c3', slug: 'yerbas', name: 'Yerbas', group: 'yerba' } as const

/** Producto publicado del catálogo de prueba. */
function product(
  overrides: Partial<ProductProps> & Pick<ProductProps, 'id' | 'sequence'>,
): Product {
  return Product.create({
    slug: `producto-${overrides.id}`,
    name: `Producto ${overrides.id}`,
    description: 'Descripción.',
    priceArs: 12100,
    status: 'published',
    featured: false,
    category: IMPERIALES,
    images: [
      { publicId: `galpon/${overrides.id}`, url: '/x.jpg', width: 10, height: 10, alt: 'x' },
    ],
    inventory: { onHand: 5, reserved: 0 },
    tabsOverride: null,
    rating: { average: 0, count: 0 },
    ...overrides,
  })
}

const CATALOG: readonly Product[] = [
  product({ id: 'a', sequence: 1, featured: true, rating: { average: 4.5, count: 2 } }),
  product({ id: 'b', sequence: 2, category: TORPEDOS, priceArs: null }),
  product({ id: 'c', sequence: 3 }),
  product({ id: 'd', sequence: 4, category: YERBAS, inventory: { onHand: 0, reserved: 0 } }),
  product({ id: 'e', sequence: 5, category: TORPEDOS }),
  product({ id: 'f', sequence: 6 }),
]

/** Repositorio de productos en memoria que recuerda el último filtro recibido. */
class InMemoryProductRepository implements ProductRepository {
  lastFilter: ProductFilter | undefined

  constructor(private readonly products: readonly Product[]) {}

  list(filter: ProductFilter): Promise<ProductList> {
    this.lastFilter = filter
    const matching = this.products.filter(
      (item) =>
        (filter.category === undefined || item.toProps().category.slug === filter.category) &&
        (filter.group === undefined || item.group === filter.group),
    )
    const start = (filter.page - 1) * filter.pageSize
    return Promise.resolve({
      items: matching.slice(start, start + filter.pageSize),
      total: matching.length,
    })
  }

  findBySlug(slug: string): Promise<Product | null> {
    return Promise.resolve(this.products.find((item) => item.slug === slug) ?? null)
  }

  listPublishedByGroup(group: string): Promise<Product[]> {
    return Promise.resolve(this.products.filter((item) => item.group === group))
  }
}

/** Ajustes de precio fijos. */
function prices(display: PriceDisplay): PriceDisplayPort {
  return { get: () => Promise.resolve(display) }
}

const TABS: ProductTabsTexts = {
  mate: { descriptionNote: 'Pieza artesanal.', materials: 'Calabaza.', care: 'Curalo.' },
  bombilla: { descriptionNote: null, materials: 'Alpaca.', care: 'Agua caliente.' },
  yerba: { descriptionNote: null, materials: '1 kg.', care: 'Lugar seco.' },
  shipping: 'Enviamos a todo el país.',
}
const tabs: ProductTabsPort = { get: () => Promise.resolve(TABS) }

const WITH_NET = prices({ showNetPrice: true, vatRatePercent: 21 })

describe('ListProductsQuery', () => {
  it('devuelve la página con las formas del contrato y el precio sin IVA', async () => {
    const repository = new InMemoryProductRepository(CATALOG)
    const page = await new ListProductsQuery(repository, WITH_NET).execute({
      sort: 'destacados',
      page: 1,
      pageSize: 2,
    })

    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 6 })
    expect(page.items[0]).toEqual({
      id: 'a',
      slug: 'producto-a',
      code: 'N°01',
      name: 'Producto a',
      description: 'Descripción.',
      categoryId: 'c1',
      categorySlug: 'imperiales',
      categoryName: 'Imperiales',
      group: 'mate',
      priceArs: 12100,
      netPriceArs: 10000,
      isPurchasable: true,
      isSoldOut: false,
      maxQuantity: 5,
      featured: true,
      mainImage: { publicId: 'galpon/a', url: '/x.jpg', width: 10, height: 10, alt: 'x' },
      rating: { average: 4.5, count: 2 },
    })
    expect(page.items[1]).toMatchObject({ priceArs: null, netPriceArs: null, isPurchasable: false })
  })

  it('no informa el precio sin IVA si los ajustes no lo muestran', async () => {
    const query = new ListProductsQuery(
      new InMemoryProductRepository(CATALOG),
      prices({ showNetPrice: false, vatRatePercent: 21 }),
    )
    const page = await query.execute({ sort: 'destacados', page: 1, pageSize: 1 })
    expect(page.items[0]?.netPriceArs).toBeNull()
  })

  it('normaliza el filtro: búsqueda sin acentos, ids únicos y ordenados, featured solo si es true', async () => {
    const repository = new InMemoryProductRepository(CATALOG)
    const query = new ListProductsQuery(repository, WITH_NET)

    await query.execute({
      q: '  BOMBILLÓN   Curvo ',
      ids: [' b ', 'a', '', 'b'],
      featured: false,
      sort: 'menor',
      page: 2,
      pageSize: 10,
    })
    expect(repository.lastFilter).toEqual({
      q: 'bombillon curvo',
      ids: ['a', 'b'],
      sort: 'menor',
      page: 2,
      pageSize: 10,
    })

    await query.execute({ q: '   ', featured: true, sort: 'az', page: 1, pageSize: 24 })
    expect(repository.lastFilter).toEqual({ featured: true, sort: 'az', page: 1, pageSize: 24 })
  })

  it('rechaza una paginación o un orden inválidos con errores en español', async () => {
    const query = new ListProductsQuery(new InMemoryProductRepository(CATALOG), WITH_NET)
    await expect(query.execute({ sort: 'az', page: 0, pageSize: 24 })).rejects.toThrow(/página/)
    await expect(query.execute({ sort: 'az', page: 2 ** 53, pageSize: 24 })).rejects.toThrow(
      /página/,
    )
    await expect(query.execute({ sort: 'az', page: 1, pageSize: 101 })).rejects.toThrow(/tamaño/)
    await expect(query.execute({ sort: 'otro' as 'az', page: 1, pageSize: 24 })).rejects.toThrow(
      /orden/,
    )
  })
})

describe('GetProductQuery', () => {
  it('arma la ficha con fotos, opciones y pestañas combinadas con las del grupo', async () => {
    const withOverride = product({
      id: 'z',
      sequence: 9,
      tabsOverride: { materials: 'Cuero propio.', care: null },
    })
    const query = new GetProductQuery(new InMemoryProductRepository([withOverride]), WITH_NET, tabs)

    const detail = await query.execute('producto-z')

    expect(detail).toMatchObject({ id: 'z', code: 'N°09', netPriceArs: 10000 })
    expect(detail?.images).toHaveLength(1)
    expect(detail?.options?.leathers).toEqual(['Negro', 'Marrón', 'Crudo', 'Borravino'])
    expect(detail?.tabs).toEqual({
      descriptionNote: 'Pieza artesanal.',
      materials: 'Cuero propio.',
      shipping: 'Enviamos a todo el país.',
      care: 'Curalo.',
    })
  })

  it('devuelve null si no hay un producto publicado con ese slug', async () => {
    const query = new GetProductQuery(new InMemoryProductRepository(CATALOG), WITH_NET, tabs)
    await expect(query.execute('no-existe')).resolves.toBeNull()
    await expect(query.execute('')).rejects.toThrow(/slug/)
  })

  it('no ofrece opciones fuera de los mates', async () => {
    const query = new GetProductQuery(new InMemoryProductRepository(CATALOG), WITH_NET, tabs)
    const yerba = await query.execute('producto-d')
    expect(yerba).toMatchObject({ options: null, isSoldOut: true, maxQuantity: 0 })
    expect(yerba?.tabs.materials).toBe('1 kg.')
  })
})

describe('GetRelatedProductsQuery', () => {
  it('devuelve hasta 4 del mismo grupo, primero los de la misma línea y sin el propio', async () => {
    const query = new GetRelatedProductsQuery(new InMemoryProductRepository(CATALOG), WITH_NET)
    const related = await query.execute('producto-a')
    expect(related?.map(({ id }) => id)).toEqual(['c', 'f', 'b', 'e'])
  })

  it('devuelve null si el producto no existe', async () => {
    const query = new GetRelatedProductsQuery(new InMemoryProductRepository(CATALOG), WITH_NET)
    await expect(query.execute('no-existe')).resolves.toBeNull()
  })
})

describe('ListCategoriesQuery', () => {
  it('ordena por posición y suma la cantidad de productos publicados', async () => {
    const listings: CategoryListing[] = [
      {
        category: { ...TORPEDOS, blurb: 'Alargados.', image: null, position: 2 },
        productCount: 6,
      },
      {
        category: {
          ...IMPERIALES,
          blurb: 'Boca ancha.',
          image: { publicId: 'galpon/i', url: '/i.jpg', width: 1, height: 1, alt: 'i' },
          position: 1,
        },
        productCount: 4,
      },
    ]
    const repository: CategoryRepository = { list: () => Promise.resolve(listings) }

    const categories = await new ListCategoriesQuery(repository).execute()

    expect(categories.map(({ slug }) => slug)).toEqual(['imperiales', 'torpedos'])
    expect(categories[0]).toEqual({
      id: 'c1',
      slug: 'imperiales',
      name: 'Imperiales',
      group: 'mate',
      blurb: 'Boca ancha.',
      image: { publicId: 'galpon/i', url: '/i.jpg', width: 1, height: 1, alt: 'i' },
      position: 1,
      productCount: 4,
    })
  })
})
