import { beforeEach, describe, expect, it } from 'vitest'

import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import { DomainError } from '../../../shared/domain/domain-error'
import { mediaUrl } from '../../media/domain/media'
import { createCategory, type ProductGroup } from '../domain/category.entity'
import {
  CatalogValidationError,
  CategoryHasProductsError,
  CategoryNotFoundError,
  ProductChangedError,
  ProductNotFoundError,
  SlugTakenError,
} from '../domain/catalog-admin-errors'
import { Product } from '../domain/product.entity'
import { ArchiveProductCommand } from './commands/archive-product.command'
import { CreateCategoryCommand } from './commands/create-category.command'
import { CreateProductCommand } from './commands/create-product.command'
import { DeleteCategoryCommand } from './commands/delete-category.command'
import { ReorderCategoriesCommand } from './commands/reorder-categories.command'
import { UpdateCategoryCommand } from './commands/update-category.command'
import { UpdateProductCommand } from './commands/update-product.command'
import type {
  AdminCategoryFields,
  AdminCategoryRepository,
  CategoryDeleteOutcome,
  CategoryWrite,
  CategoryWriteOutcome,
} from './ports/admin-category.repository.port'
import type {
  AdminProductFields,
  AdminProductFilter,
  AdminProductList,
  AdminProductRecord,
  AdminProductRepository,
  ProductWrite,
  ProductWriteOutcome,
} from './ports/admin-product.repository.port'
import type { CategoryListing } from './ports/category.repository.port'
import type { PriceDisplayPort } from './ports/price-display.port'
import type { ProductTabsPort } from './ports/product-tabs.port'
import { GetAdminProductQuery } from './queries/get-admin-product.query'
import { ListAdminProductsQuery } from './queries/list-admin-products.query'

const CLOUD = 'galpon-mock'
const NOW = new Date('2026-11-04T12:00:00.000Z')
const MATES = '0190a000-0000-7000-8000-00000000c001'
const BOMBILLAS = '0190a000-0000-7000-8000-00000000c002'
const PREMIUM = '0190a000-0000-7000-8000-00000000a001'
const CURVO = '0190a000-0000-7000-8000-00000000a002'

const GROUPS: Readonly<Record<string, ProductGroup>> = { [MATES]: 'mate', [BOMBILLAS]: 'bombilla' }

const prices: PriceDisplayPort = {
  get: () => Promise.resolve({ showNetPrice: false, vatRatePercent: 21 }),
}
const group = {
  descriptionNote: null,
  materials: 'Materiales del grupo',
  care: 'Cuidado del grupo',
}
const tabs: ProductTabsPort = {
  get: () => Promise.resolve({ mate: group, bombilla: group, yerba: group, shipping: 'Envíos' }),
}

/** Producto válido para el formulario, con lo que cada caso cambia. */
function fields(overrides: Partial<AdminProductFields> = {}): AdminProductFields {
  return {
    name: 'Mate Nuevo',
    slug: 'mate-nuevo',
    categoryId: MATES,
    description: 'Un mate de prueba para el dashboard.',
    priceArs: 25000,
    stock: 5,
    featured: false,
    status: 'published',
    tabsOverride: null,
    images: [{ publicId: 'galpon/productos/mate-nuevo', width: 960, height: 1280, alt: 'Mate' }],
    leathers: ['Negro', 'Crudo'],
    ...overrides,
  }
}

/** Productos del dashboard en memoria: imita las respuestas del repositorio de Prisma. */
class MemoryProducts implements AdminProductRepository {
  readonly records = new Map<string, AdminProductRecord>()
  readonly events: NewDomainEvent[] = []
  lastFilter: AdminProductFilter | null = null
  private nextSequence = 3

  constructor() {
    this.records.set(
      PREMIUM,
      this.build(
        PREMIUM,
        1,
        {
          ...fields({ name: 'Mate Imperial Premium', slug: 'mate-imperial-premium' }),
          images: [
            {
              publicId: 'local/premium',
              url: '/mock-images/premium.jpg',
              width: 960,
              height: 1280,
              alt: 'Premium',
            },
          ],
        },
        [],
        2,
      ),
    )
    this.records.set(
      CURVO,
      this.build(
        CURVO,
        2,
        {
          ...fields({
            name: 'Bombillón Curvo',
            slug: 'bombillon-curvo',
            categoryId: BOMBILLAS,
            leathers: [],
          }),
          images: [],
        },
        ['bombillon-viejo'],
        0,
      ),
    )
  }

  private build(
    id: string,
    sequence: number,
    write: ProductWrite,
    previousSlugs: string[],
    reserved: number,
    status: 'draft' | 'published' | 'archived' = write.status,
  ): AdminProductRecord {
    const groupOf = GROUPS[write.categoryId] ?? 'mate'
    return {
      product: Product.create({
        id,
        sequence,
        slug: write.slug,
        name: write.name,
        description: write.description,
        priceArs: write.priceArs,
        status,
        featured: write.featured,
        category: { id: write.categoryId, slug: groupOf, name: groupOf, group: groupOf },
        images: write.images.map((image) => ({ ...image })),
        inventory: { onHand: write.stock + reserved, reserved },
        tabsOverride: write.tabsOverride,
        rating: { average: 0, count: 0 },
        leathers: write.leathers,
      }),
      previousSlugs,
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  private slugTaken(slug: string, ownId: string | null): boolean {
    return [...this.records.values()].some(
      ({ product, previousSlugs }) =>
        product.id !== ownId && (product.slug === slug || previousSlugs.includes(slug)),
    )
  }

  list(filter: AdminProductFilter): Promise<AdminProductList> {
    this.lastFilter = filter
    const items = [...this.records.values()]
    return Promise.resolve({ items, total: items.length })
  }

  findById(id: string): Promise<AdminProductRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null)
  }

  findCategoryGroup(categoryId: string): Promise<ProductGroup | null> {
    return Promise.resolve(GROUPS[categoryId] ?? null)
  }

  create(product: ProductWrite, event: NewDomainEvent): Promise<ProductWriteOutcome> {
    if (this.slugTaken(product.slug, null)) return Promise.resolve({ kind: 'slug_taken' })
    const id = `0190a000-0000-7000-8000-00000000a00${String(this.nextSequence)}`
    const record = this.build(id, this.nextSequence, product, [], 0)
    this.nextSequence += 1
    this.records.set(id, record)
    this.events.push(event)
    return Promise.resolve({ kind: 'saved', record })
  }

  update(
    id: string,
    product: ProductWrite,
    expectedUpdatedAt: Date | null,
    event: NewDomainEvent,
  ): Promise<ProductWriteOutcome> {
    const current = this.records.get(id)
    if (current === undefined) return Promise.resolve({ kind: 'not_found' })
    if (expectedUpdatedAt !== null && expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) {
      return Promise.resolve({ kind: 'changed' })
    }
    if (this.slugTaken(product.slug, id)) return Promise.resolve({ kind: 'slug_taken' })
    const old = current.product.slug
    const previous =
      old === product.slug
        ? current.previousSlugs
        : [...current.previousSlugs.filter((slug) => slug !== product.slug), old]
    const reserved = current.product.toProps().inventory.reserved
    const record = this.build(id, current.product.toProps().sequence, product, previous, reserved)
    this.records.set(id, record)
    this.events.push(event)
    return Promise.resolve({ kind: 'saved', record })
  }

  archive(id: string, event: NewDomainEvent): Promise<AdminProductRecord | null> {
    const current = this.records.get(id)
    if (current === undefined) return Promise.resolve(null)
    const props = current.product.toProps()
    const record = {
      ...current,
      product: Product.create({ ...props, status: 'archived' }),
    }
    this.records.set(id, record)
    this.events.push(event)
    return Promise.resolve(record)
  }
}

describe('productos del dashboard', () => {
  let products: MemoryProducts

  beforeEach(() => {
    products = new MemoryProducts()
  })

  const create = () => new CreateProductCommand(products, prices, tabs, CLOUD)
  const update = () => new UpdateProductCommand(products, prices, tabs, CLOUD)

  /** Ejecuta y devuelve el error de dominio (o falla si no hubo). */
  async function failure(run: () => Promise<unknown>): Promise<DomainError> {
    try {
      await run()
    } catch (error) {
      if (error instanceof DomainError) return error
      throw error
    }
    throw new Error('esperaba un error de dominio')
  }

  it('alta: arma la foto nueva con la nube, guarda los cueros y avisa una vez', async () => {
    const created = await create().execute(fields({ leathers: ['Crudo', 'Negro'] }))
    expect(created).toMatchObject({
      slug: 'mate-nuevo',
      code: 'N°03',
      sequence: 3,
      status: 'published',
      stock: 5,
      leathers: ['Negro', 'Crudo'],
      tabsOverride: null,
      previousSlugs: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      tabs: { materials: 'Materiales del grupo', care: 'Cuidado del grupo', shipping: 'Envíos' },
    })
    expect(created.images).toEqual([
      {
        publicId: 'galpon/productos/mate-nuevo',
        url: mediaUrl(CLOUD, 'galpon/productos/mate-nuevo'),
        width: 960,
        height: 1280,
        alt: 'Mate',
      },
    ])
    expect(products.events).toEqual([
      {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'product.created',
        payload: {
          reason: 'product.created',
          tags: ['products', 'product:mate-nuevo', 'categories', 'combos'],
        },
      },
    ])
  })

  it('alta: la línea que no existe, los cueros fuera de un mate y la foto ajena dan 422', async () => {
    const unknown = await failure(() => create().execute(fields({ categoryId: 'cat-mates' })))
    expect(unknown).toBeInstanceOf(CatalogValidationError)
    expect(unknown.errors).toEqual([
      { field: 'categoryId', code: 'unknown_category', message: 'Esa línea no existe' },
    ])

    const leathers = await failure(() =>
      create().execute(fields({ categoryId: BOMBILLAS, leathers: ['Negro'] })),
    )
    expect(leathers.status).toBe(422)
    expect(leathers.errors).toEqual([
      { field: 'leathers', code: 'leathers_not_allowed', message: 'Solo los mates llevan cuero' },
    ])

    const image = await failure(() =>
      create().execute(
        fields({
          images: [
            { publicId: 'galpon/productos/a', width: 1, height: 1, alt: 'Una' },
            { publicId: 'galpon/lineas/x', width: 1, height: 1, alt: 'Otra' },
          ],
        }),
      ),
    )
    expect(image.errors).toEqual([
      {
        field: 'images.1.publicId',
        code: 'unknown_image',
        message: 'La foto no existe: subila de nuevo',
      },
    ])
    expect(products.events).toEqual([])
  })

  it('alta: el slug de otro producto (actual o anterior) da 409 slug_taken sin avisar', async () => {
    for (const slug of ['mate-imperial-premium', 'bombillon-viejo']) {
      const error = await failure(() => create().execute(fields({ slug })))
      expect(error).toBeInstanceOf(SlugTakenError)
      expect(error).toMatchObject({
        status: 409,
        code: 'slug_taken',
        title: 'El slug ya está en uso',
        detail: `Ya hay algo con el slug ${slug}.`,
      })
    }
    expect(products.events).toEqual([])
  })

  it('edición: product_changed gana a la línea, los cueros, las fotos y el slug', async () => {
    const error = await failure(() =>
      update().execute(
        PREMIUM,
        fields({
          slug: 'bombillon-curvo',
          categoryId: 'no-existe',
          leathers: ['Negro'],
          images: [{ publicId: 'otra/carpeta', width: 1, height: 1, alt: 'Foto' }],
        }),
        '2026-11-04T11:59:59.999Z',
      ),
    )
    expect(error).toBeInstanceOf(ProductChangedError)
    expect(error).toMatchObject({
      status: 409,
      code: 'product_changed',
      title: 'El producto cambió',
      detail: 'El producto cambió desde que lo abriste.',
    })
    expect(products.events).toEqual([])
  })

  it('edición: con el updatedAt guardado (al milisegundo) o sin él, guarda', async () => {
    const same = await update().execute(PREMIUM, fields(), '2026-11-04T09:00:00.000-03:00')
    expect(same.slug).toBe('mate-nuevo')
    const blind = await update().execute(PREMIUM, fields({ name: 'Otro nombre' }), null)
    expect(blind.name).toBe('Otro nombre')
  })

  it('edición: cambiar el slug avisa el nuevo y el anterior, y el anterior queda en previousSlugs', async () => {
    const updated = await update().execute(PREMIUM, fields(), null)
    expect(updated.previousSlugs).toEqual(['mate-imperial-premium'])
    expect(products.events.map((event) => event.payload)).toEqual([
      {
        reason: 'product.updated',
        tags: [
          'products',
          'product:mate-nuevo',
          'product:mate-imperial-premium',
          'categories',
          'combos',
        ],
      },
    ])
  })

  it('edición: la foto que ya tenía conserva su url aunque esté fuera de la carpeta', async () => {
    const updated = await update().execute(
      PREMIUM,
      fields({
        slug: 'mate-imperial-premium',
        images: [{ publicId: 'local/premium', width: 10, height: 20, alt: 'Otro alt' }],
      }),
      null,
    )
    expect(updated.images).toEqual([
      {
        publicId: 'local/premium',
        url: '/mock-images/premium.jpg',
        width: 10,
        height: 20,
        alt: 'Otro alt',
      },
    ])
    expect(products.events[0]?.payload).toEqual({
      reason: 'product.updated',
      tags: ['products', 'product:mate-imperial-premium', 'categories', 'combos'],
    })
  })

  it('edición: el stock es lo disponible (las reservas no cuentan)', async () => {
    expect((await new GetAdminProductQuery(products, prices, tabs).execute(PREMIUM)).stock).toBe(5)
    const updated = await update().execute(PREMIUM, fields({ stock: 7 }), null)
    expect(updated.stock).toBe(7)
    expect(products.records.get(PREMIUM)?.product.toProps().inventory).toEqual({
      onHand: 9,
      reserved: 2,
    })
  })

  it('edición: un id que no existe (o que no es un UUID) da 404', async () => {
    for (const id of ['0190a000-0000-7000-8000-0000000000ff', 'prd-imperial-premium']) {
      const error = await failure(() => update().execute(id, fields(), null))
      expect(error).toBeInstanceOf(ProductNotFoundError)
      expect(error).toMatchObject({ status: 404, detail: 'No existe ese producto.' })
    }
    const get = await failure(() => new GetAdminProductQuery(products, prices, tabs).execute('x'))
    expect(get).toBeInstanceOf(ProductNotFoundError)
  })

  it('archivar avisa product.archived y un PATCH con published lo vuelve a publicar', async () => {
    const archive = new ArchiveProductCommand(products, prices, tabs)
    const archived = await archive.execute(PREMIUM.toUpperCase())
    expect(archived.status).toBe('archived')
    expect(products.events[0]?.payload).toEqual({
      reason: 'product.archived',
      tags: ['products', 'product:mate-imperial-premium', 'categories', 'combos'],
    })
    const back = await update().execute(PREMIUM, fields({ slug: 'mate-imperial-premium' }), null)
    expect(back.status).toBe('published')
    expect(await failure(() => archive.execute(CURVO.replace('a002', 'a0ff')))).toBeInstanceOf(
      ProductNotFoundError,
    )
  })

  it('listado: pasa los filtros y la búsqueda normalizada sin acentos', async () => {
    const page = await new ListAdminProductsQuery(products, prices, tabs).execute({
      q: '  Bombillón   CURVO ',
      status: 'draft',
      stock: 'out',
      category: 'imperiales',
      sort: 'az',
      page: 2,
      pageSize: 10,
    })
    expect(products.lastFilter).toEqual({
      search: 'bombillon curvo',
      status: 'draft',
      stockOut: true,
      categorySlug: 'imperiales',
      sort: 'az',
      page: 2,
      pageSize: 10,
    })
    expect(page).toMatchObject({ page: 2, pageSize: 10, total: 2 })
    expect(page.items.map((item) => item.code)).toEqual(['N°01', 'N°02'])

    await new ListAdminProductsQuery(products, prices, tabs).execute({
      q: '   ',
      page: 1,
      pageSize: 24,
    })
    expect(products.lastFilter).toEqual({
      search: null,
      status: null,
      stockOut: false,
      categorySlug: null,
      sort: null,
      page: 1,
      pageSize: 24,
    })
  })
})

/** Líneas del dashboard en memoria. */
class MemoryCategories implements AdminCategoryRepository {
  readonly listings = new Map<string, CategoryListing>()
  readonly productTotals = new Map<string, number>([[MATES, 3]])
  readonly events: NewDomainEvent[] = []

  constructor() {
    this.listings.set(
      MATES,
      this.build(MATES, 1, {
        name: 'Imperiales',
        slug: 'imperiales',
        group: 'mate',
        blurb: '',
        image: {
          publicId: 'galpon/productos/premium',
          url: '/premium.jpg',
          width: 1,
          height: 1,
          alt: 'Premium',
        },
      }),
    )
    this.listings.set(
      BOMBILLAS,
      this.build(BOMBILLAS, 2, {
        name: 'Bombillones',
        slug: 'bombillones',
        group: 'bombilla',
        blurb: '',
        image: null,
      }),
    )
  }

  private build(id: string, position: number, write: CategoryWrite): CategoryListing {
    return {
      category: createCategory({ id, position, ...write }),
      productCount: this.productTotals.get(id) ?? 0,
    }
  }

  list(): Promise<CategoryListing[]> {
    return Promise.resolve([...this.listings.values()])
  }

  findById(id: string): Promise<CategoryListing | null> {
    return Promise.resolve(this.listings.get(id) ?? null)
  }

  create(category: CategoryWrite, event: NewDomainEvent): Promise<CategoryWriteOutcome> {
    if ([...this.listings.values()].some((other) => other.category.slug === category.slug)) {
      return Promise.resolve({ kind: 'slug_taken' })
    }
    const id = '0190a000-0000-7000-8000-00000000c003'
    const listing = this.build(id, this.listings.size + 1, category)
    this.listings.set(id, listing)
    this.events.push(event)
    return Promise.resolve({ kind: 'saved', listing })
  }

  update(
    id: string,
    category: CategoryWrite,
    event: NewDomainEvent,
  ): Promise<CategoryWriteOutcome> {
    const current = this.listings.get(id)
    if (current === undefined) return Promise.resolve({ kind: 'not_found' })
    if (current.category.group !== category.group && (this.productTotals.get(id) ?? 0) > 0) {
      return Promise.resolve({ kind: 'group_locked' })
    }
    const listing = this.build(id, current.category.position, category)
    this.listings.set(id, listing)
    this.events.push(event)
    return Promise.resolve({ kind: 'saved', listing })
  }

  delete(id: string, event: NewDomainEvent): Promise<CategoryDeleteOutcome> {
    if (!this.listings.has(id)) return Promise.resolve('not_found')
    if ((this.productTotals.get(id) ?? 0) > 0) return Promise.resolve('has_products')
    this.listings.delete(id)
    this.events.push(event)
    return Promise.resolve('deleted')
  }

  listIds(): Promise<string[]> {
    return Promise.resolve([...this.listings.keys()])
  }

  reorder(_ids: readonly string[], event: NewDomainEvent): Promise<void> {
    this.events.push(event)
    return Promise.resolve()
  }
}

describe('líneas del dashboard', () => {
  let categories: MemoryCategories

  beforeEach(() => {
    categories = new MemoryCategories()
  })

  const input = (overrides: Partial<AdminCategoryFields> = {}): AdminCategoryFields => ({
    name: 'Calabazas',
    slug: 'calabazas',
    group: 'mate',
    blurb: 'Mates de calabaza.',
    image: null,
    ...overrides,
  })

  async function failure(run: () => Promise<unknown>): Promise<DomainError> {
    try {
      await run()
    } catch (error) {
      if (error instanceof DomainError) return error
      throw error
    }
    throw new Error('esperaba un error de dominio')
  }

  it('alta: al final, con su foto de la carpeta de líneas, y avisa categories y products', async () => {
    const created = await new CreateCategoryCommand(categories, CLOUD).execute(
      input({
        image: { publicId: 'galpon/lineas/calabazas', width: 800, height: 600, alt: 'Línea' },
      }),
    )
    expect(created).toMatchObject({ slug: 'calabazas', position: 3, productCount: 0 })
    expect(created.image?.url).toBe(mediaUrl(CLOUD, 'galpon/lineas/calabazas'))
    expect(categories.events.map((event) => event.payload)).toEqual([
      { reason: 'category.created', tags: ['categories', 'products'] },
    ])
  })

  it('alta: una foto de otra carpeta da 422 en image.publicId y el slug repetido 409', async () => {
    const image = await failure(() =>
      new CreateCategoryCommand(categories, CLOUD).execute(
        input({ image: { publicId: 'galpon/productos/x', width: 1, height: 1, alt: 'Foto' } }),
      ),
    )
    expect(image.errors).toEqual([
      {
        field: 'image.publicId',
        code: 'unknown_image',
        message: 'La foto no existe: subila de nuevo',
      },
    ])
    const slug = await failure(() =>
      new CreateCategoryCommand(categories, CLOUD).execute(input({ slug: 'imperiales' })),
    )
    expect(slug).toBeInstanceOf(SlugTakenError)
    expect(categories.events).toEqual([])
  })

  it('edición: conserva la foto guardada y cambiar el grupo con productos da 422 en group', async () => {
    const update = new UpdateCategoryCommand(categories, CLOUD)
    const kept = await update.execute(
      MATES,
      input({
        slug: 'imperiales',
        image: { publicId: 'galpon/productos/premium', width: 1, height: 1, alt: 'Nuevo alt' },
      }),
    )
    expect(kept.image).toEqual({
      publicId: 'galpon/productos/premium',
      url: '/premium.jpg',
      width: 1,
      height: 1,
      alt: 'Nuevo alt',
    })
    const locked = await failure(() => update.execute(MATES, input({ group: 'yerba' })))
    expect(locked.errors).toEqual([
      {
        field: 'group',
        code: 'category_has_products',
        message: 'La línea tiene productos: mové los productos antes de cambiarle el grupo.',
      },
    ])
    expect(await failure(() => update.execute('cat-x', input()))).toBeInstanceOf(
      CategoryNotFoundError,
    )
    expect(categories.events.map((event) => event.payload)).toEqual([
      { reason: 'category.updated', tags: ['categories', 'products'] },
    ])
  })

  it('borrado: con productos 409, sin productos avisa y uno que no existe 404', async () => {
    const remove = new DeleteCategoryCommand(categories)
    const busy = await failure(() => remove.execute(MATES))
    expect(busy).toBeInstanceOf(CategoryHasProductsError)
    expect(busy).toMatchObject({
      status: 409,
      code: 'category_has_products',
      title: 'La línea tiene productos',
      detail: 'Mové o borrá los productos de la línea antes de borrarla.',
    })
    await remove.execute(BOMBILLAS)
    const missing = await failure(() => remove.execute(BOMBILLAS))
    expect(missing).toMatchObject({ status: 404, detail: 'No existe esa línea.' })
    expect(categories.events.map((event) => event.aggregateId)).toEqual(['category.deleted'])
  })

  it('orden: tiene que traer todas las líneas una vez cada una', async () => {
    const reorder = new ReorderCategoriesCommand(categories)
    for (const ids of [[MATES], [MATES, MATES], [MATES, BOMBILLAS, 'otra']]) {
      const error = await failure(() => reorder.execute(ids))
      expect(error.errors).toEqual([
        {
          field: 'ids',
          code: 'invalid_value',
          message: 'El orden tiene que tener todas las líneas, una vez cada una.',
        },
      ])
    }
    await reorder.execute([BOMBILLAS, MATES.toUpperCase()])
    expect(categories.events.map((event) => event.payload)).toEqual([
      { reason: 'category.reordered', tags: ['categories', 'products'] },
    ])
  })
})
