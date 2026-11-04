import { beforeEach, describe, expect, it } from 'vitest'

import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import { ComboNotFoundError, ComboValidationError } from '../domain/combo-errors'
import type { ComboRecord } from '../domain/combo.entity'
import { LEATHERS, Product, type ProductProps } from '../domain/product.entity'
import { CreateComboCommand } from './commands/create-combo.command'
import { DeleteComboCommand } from './commands/delete-combo.command'
import { ReorderCombosCommand } from './commands/reorder-combos.command'
import { UpdateComboCommand } from './commands/update-combo.command'
import type { ComboFields, ComboRepository, StoredCombo } from './ports/combo.repository.port'
import type { PriceDisplay, PriceDisplayPort } from './ports/price-display.port'
import { ListAdminCombosQuery } from './queries/list-admin-combos.query'
import { ListCombosQuery } from './queries/list-combos.query'
import type { ComboView } from './read-models'

const IMPERIALES = { id: 'c-imp', slug: 'imperiales', name: 'Imperiales', group: 'mate' } as const
const CAMIONEROS = { id: 'c-cam', slug: 'camioneros', name: 'Camioneros', group: 'mate' } as const
const BOMBILLAS = { id: 'c-bom', slug: 'bombillas', name: 'Bombillas', group: 'bombilla' } as const
const YERBAS = { id: 'c-yer', slug: 'yerbas', name: 'Yerbas', group: 'yerba' } as const

const IMAGE = { publicId: 'galpon/imperial', url: '/imperial.jpg', width: 10, height: 10, alt: 'x' }

/**
 * Producto publicado con precio y 12 unidades (los mates con los cuatro cueros), salvo lo que
 * cambie el caso.
 */
function product(overrides: Partial<ProductProps> & Pick<ProductProps, 'id' | 'slug'>): Product {
  const group = (overrides.category ?? IMPERIALES).group
  return Product.create({
    sequence: 1,
    name: `Producto ${overrides.slug}`,
    description: 'Descripción.',
    priceArs: 10000,
    status: 'published',
    featured: false,
    category: IMPERIALES,
    images: [],
    inventory: { onHand: 12, reserved: 0 },
    tabsOverride: null,
    rating: { average: 0, count: 0 },
    leathers: group === 'mate' ? [...LEATHERS] : [],
    ...overrides,
  })
}

const IMPERIAL = product({
  id: 'p-imperial',
  slug: 'mate-imperial-premium',
  name: 'Mate Imperial Premium',
  priceArs: 39999,
  images: [IMAGE],
})
const CURVO = product({
  id: 'p-curvo',
  slug: 'bombillon-premium-curvo',
  name: 'Bombillón Premium Curvo',
  priceArs: 28999,
  category: BOMBILLAS,
})
const CAMIONERO = product({
  id: 'p-camionero',
  slug: 'camionero-virola-de-aluminio',
  priceArs: 24999,
  category: CAMIONEROS,
})
const CANARIAS = product({
  id: 'p-canarias',
  slug: 'yerba-canarias-1-kg',
  priceArs: 9999,
  category: YERBAS,
})
const SERENA = product({
  id: 'p-serena',
  slug: 'yerba-canarias-serena-1-kg',
  priceArs: 12500,
  category: YERBAS,
})
const GALLETA = product({
  id: 'p-galleta',
  slug: 'mate-galleta',
  priceArs: 27999,
  inventory: { onHand: 0, reserved: 0 },
})
const POCO_STOCK = product({
  id: 'p-poco',
  slug: 'bombilla-poco-stock',
  priceArs: 15000,
  category: BOMBILLAS,
  inventory: { onHand: 9, reserved: 4 },
})
const BORRADOR = product({ id: 'p-borrador', slug: 'mate-borrador', status: 'draft' })
const ARCHIVADO = product({ id: 'p-archivado', slug: 'mate-archivado', status: 'archived' })
const CONSULTAR = product({
  id: 'p-consultar',
  slug: 'bombilla-a-consultar',
  priceArs: null,
  category: BOMBILLAS,
})

const PRODUCTS: readonly Product[] = [
  IMPERIAL,
  CURVO,
  CAMIONERO,
  CANARIAS,
  SERENA,
  GALLETA,
  POCO_STOCK,
  BORRADOR,
  ARCHIVADO,
  CONSULTAR,
]

/** Combo guardado de prueba. */
function combo(
  overrides: Partial<ComboRecord> & Pick<ComboRecord, 'id' | 'position'>,
): ComboRecord {
  return {
    name: `Combo ${overrides.id}`,
    description: '',
    productIds: [IMPERIAL.id, CURVO.id],
    priceArs: 61999,
    status: 'published',
    ...overrides,
  }
}

const DUO = combo({
  id: 'duo',
  name: 'Dúo Imperial',
  description: 'El imperial de ceremonia con el bombillón curvo de pico de bronce.',
  position: 1,
})
const CAMIONERO_Y_CANARIAS = combo({
  id: 'camionero',
  productIds: [CAMIONERO.id, CANARIAS.id],
  priceArs: 31499,
  position: 2,
})

/** Igualdad de ids como la de una columna `uuid` de Postgres: sin distinguir mayúsculas. */
function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Combos en memoria, con los eventos que guardaría el outbox. */
class InMemoryComboRepository implements ComboRepository {
  /** Eventos `combo.changed` de las escrituras que se hicieron. */
  readonly events: NewDomainEvent[] = []
  private readonly combos: ComboRecord[]

  constructor(
    private readonly products: readonly Product[],
    combos: readonly ComboRecord[],
  ) {
    this.combos = combos.map((item) => ({ ...item, productIds: [...item.productIds] }))
  }

  /** Copia ordenada por posición (y, a igual posición, por alta). */
  private ordered(): ComboRecord[] {
    return [...this.combos].sort((a, b) => a.position - b.position)
  }

  private stored(record: ComboRecord): StoredCombo {
    return {
      combo: { ...record, productIds: [...record.productIds] },
      pieces: record.productIds.flatMap((id) =>
        this.products.filter((item) => sameId(item.id, id)),
      ),
    }
  }

  /** Posiciones por id, en el orden del listado. */
  positions(): Record<string, number> {
    return Object.fromEntries(this.ordered().map((item) => [item.id, item.position]))
  }

  list(): Promise<StoredCombo[]> {
    return Promise.resolve(this.ordered().map((item) => this.stored(item)))
  }

  findById(id: string): Promise<StoredCombo | null> {
    const found = this.combos.find((item) => sameId(item.id, id))
    return Promise.resolve(found === undefined ? null : this.stored(found))
  }

  findProducts(ids: readonly string[]): Promise<Product[]> {
    return Promise.resolve(this.products.filter((item) => ids.some((id) => sameId(item.id, id))))
  }

  listIds(): Promise<string[]> {
    return Promise.resolve(this.ordered().map((item) => item.id))
  }

  create(id: string, fields: ComboFields, event: NewDomainEvent): Promise<StoredCombo> {
    const position = Math.max(0, ...this.combos.map((item) => item.position)) + 1
    const created = { id, position, ...fields, productIds: [...fields.productIds] }
    this.combos.push(created)
    this.events.push(event)
    return Promise.resolve(this.stored(created))
  }

  update(id: string, fields: ComboFields, event: NewDomainEvent): Promise<StoredCombo | null> {
    const found = this.combos.find((item) => sameId(item.id, id))
    if (found === undefined) return Promise.resolve(null)
    Object.assign(found, fields, { productIds: [...fields.productIds] })
    this.events.push(event)
    return Promise.resolve(this.stored(found))
  }

  delete(id: string, event: NewDomainEvent): Promise<boolean> {
    const index = this.combos.findIndex((item) => sameId(item.id, id))
    if (index === -1) return Promise.resolve(false)
    this.combos.splice(index, 1)
    this.ordered().forEach((item, position) => {
      item.position = position + 1
    })
    this.events.push(event)
    return Promise.resolve(true)
  }

  reorder(ids: readonly string[], event: NewDomainEvent): Promise<void> {
    ids.forEach((id, index) => {
      const found = this.combos.find((item) => sameId(item.id, id))
      if (found !== undefined) found.position = index + 1
    })
    this.events.push(event)
    return Promise.resolve()
  }
}

/** Ajustes de precios fijos: precio sin IVA al 21 %. */
class FixedPriceDisplay implements PriceDisplayPort {
  constructor(
    private readonly display: PriceDisplay = { showNetPrice: true, vatRatePercent: 21 },
  ) {}

  get(): Promise<PriceDisplay> {
    return Promise.resolve(this.display)
  }
}

/** Datos válidos del Dúo Imperial, como los manda el dashboard. */
const DUO_FIELDS: ComboFields = {
  name: 'Dúo Imperial',
  description: 'El imperial de ceremonia con el bombillón curvo de pico de bronce.',
  productIds: [IMPERIAL.id, CURVO.id],
  priceArs: 61999,
  status: 'published',
}

const UNAVAILABLE = 'Elegí un producto publicado y con precio'
const DISTINCT_GROUPS = 'Elegí productos de grupos distintos'
const ORDER_INCOMPLETE = 'El orden tiene que tener todos los combos, una vez cada uno.'

/** Errores por campo de un 422 de combos (falla el test si no es un `ComboValidationError`). */
async function validationErrors(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ComboValidationError)
  return error instanceof ComboValidationError ? error.errors : undefined
}

describe('ListCombosQuery (GET /combos)', () => {
  it('arma el Dúo Imperial con los derivados del mock (lista, ahorro, sin IVA y stock)', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [DUO])
    const [duo] = await new ListCombosQuery(repository, new FixedPriceDisplay()).execute()

    expect(duo).toEqual<ComboView>({
      id: 'duo',
      name: 'Dúo Imperial',
      description: 'El imperial de ceremonia con el bombillón curvo de pico de bronce.',
      items: [
        {
          productId: IMPERIAL.id,
          slug: 'mate-imperial-premium',
          name: 'Mate Imperial Premium',
          group: 'mate',
          leathers: ['Negro', 'Marrón', 'Crudo', 'Borravino'],
          unitPriceArs: 39999,
          isPurchasable: true,
          maxQuantity: 12,
          image: IMAGE,
        },
        {
          productId: CURVO.id,
          slug: 'bombillon-premium-curvo',
          name: 'Bombillón Premium Curvo',
          group: 'bombilla',
          leathers: [],
          unitPriceArs: 28999,
          isPurchasable: true,
          maxQuantity: 12,
          image: null,
        },
      ],
      priceArs: 61999,
      netPriceArs: 51239,
      listPriceArs: 68998,
      savingsArs: 6999,
      isPurchasable: true,
      isSoldOut: false,
      maxQuantity: 12,
      status: 'published',
      position: 1,
    })
  })

  it('solo trae los publicados con todas sus piezas publicadas, con precio y de grupos distintos, por posición', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [
      combo({ id: 'tercero', position: 3, productIds: [CANARIAS.id, CURVO.id], priceArs: 30000 }),
      CAMIONERO_Y_CANARIAS,
      DUO,
      combo({ id: 'borrador', position: 4, status: 'draft' }),
      combo({ id: 'pieza-borrador', position: 5, productIds: [BORRADOR.id, CURVO.id] }),
      combo({ id: 'pieza-archivada', position: 6, productIds: [ARCHIVADO.id, CURVO.id] }),
      combo({ id: 'pieza-consultar', position: 7, productIds: [IMPERIAL.id, CONSULTAR.id] }),
      combo({ id: 'mismo-grupo', position: 8, productIds: [IMPERIAL.id, CAMIONERO.id] }),
      combo({ id: 'pieza-borrada', position: 9, productIds: [IMPERIAL.id, 'p-no-existe'] }),
    ])

    const combos = await new ListCombosQuery(repository, new FixedPriceDisplay()).execute()

    expect(combos.map(({ id }) => id)).toEqual(['duo', 'camionero', 'tercero'])
  })

  it('un combo con una pieza sin stock sale igual, con isSoldOut y sin poder comprarse', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [
      combo({ id: 'galleta', position: 1, productIds: [GALLETA.id, CANARIAS.id], priceArs: 33999 }),
    ])

    const [galleta] = await new ListCombosQuery(repository, new FixedPriceDisplay()).execute()

    expect(galleta).toMatchObject({
      isPurchasable: false,
      isSoldOut: true,
      maxQuantity: 0,
      listPriceArs: 37998,
      savingsArs: 3999,
    })
  })

  it('maxQuantity es el menor de las piezas (stock menos lo reservado) y el ahorro nunca es negativo', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [
      combo({ id: 'caro', position: 1, productIds: [IMPERIAL.id, POCO_STOCK.id], priceArs: 60000 }),
    ])

    const [caro] = await new ListCombosQuery(repository, new FixedPriceDisplay()).execute()

    expect(caro).toMatchObject({ listPriceArs: 54999, savingsArs: 0, maxQuantity: 5 })
  })

  it('netPriceArs es null si los ajustes no muestran el precio sin impuestos', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [DUO])
    const prices = new FixedPriceDisplay({ showNetPrice: false, vatRatePercent: 21 })

    const [duo] = await new ListCombosQuery(repository, prices).execute()

    expect(duo?.netPriceArs).toBeNull()
  })
})

describe('ListAdminCombosQuery (GET /admin/combos)', () => {
  it('trae todos por posición, con los rotos sin poder comprarse', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [
      combo({ id: 'consultar', position: 3, productIds: [IMPERIAL.id, CONSULTAR.id] }),
      combo({ id: 'borrador', position: 2, status: 'draft' }),
      DUO,
      combo({ id: 'mismo-grupo', position: 4, productIds: [IMPERIAL.id, CAMIONERO.id] }),
    ])

    const combos = await new ListAdminCombosQuery(repository, new FixedPriceDisplay()).execute()

    expect(
      combos.map(({ id, isPurchasable, maxQuantity }) => ({ id, isPurchasable, maxQuantity })),
    ).toEqual([
      { id: 'duo', isPurchasable: true, maxQuantity: 12 },
      { id: 'borrador', isPurchasable: false, maxQuantity: 0 },
      { id: 'consultar', isPurchasable: false, maxQuantity: 0 },
      { id: 'mismo-grupo', isPurchasable: false, maxQuantity: 0 },
    ])
    // La lista suma solo las piezas con precio; la "a consultar" sale con `unitPriceArs` null.
    expect(combos[2]).toMatchObject({
      listPriceArs: 39999,
      items: [{ unitPriceArs: 39999 }, { unitPriceArs: null, isPurchasable: false }],
    })
  })
})

describe('CreateComboCommand (POST /admin/combos)', () => {
  let repository: InMemoryComboRepository
  let create: CreateComboCommand

  beforeEach(() => {
    repository = new InMemoryComboRepository(PRODUCTS, [DUO, CAMIONERO_Y_CANARIAS])
    create = new CreateComboCommand(repository, new FixedPriceDisplay())
  })

  it('crea al final (la mayor posición + 1) y guarda combo.changed created', async () => {
    const created = await create.execute({ ...DUO_FIELDS, name: 'Otro dúo', status: 'draft' })

    expect(created).toMatchObject({ name: 'Otro dúo', status: 'draft', position: 3 })
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    expect(repository.events).toEqual([
      {
        type: 'combo.changed',
        aggregateType: 'combo',
        aggregateId: created.id,
        payload: { comboId: created.id, change: 'created' },
      },
    ])
  })

  it('el primer combo queda en la posición 1', async () => {
    const empty = new InMemoryComboRepository(PRODUCTS, [])

    const created = await new CreateComboCommand(empty, new FixedPriceDisplay()).execute(DUO_FIELDS)

    expect(created.position).toBe(1)
  })

  it('cada producto que no existe, no está publicado o es "a consultar" falla en productIds.N', async () => {
    const errors = await validationErrors(
      create.execute({
        ...DUO_FIELDS,
        productIds: ['p-no-existe', BORRADOR.id, CONSULTAR.id],
      }),
    )

    expect(errors).toEqual([
      { field: 'productIds.0', code: 'product_unavailable', message: UNAVAILABLE },
      { field: 'productIds.1', code: 'product_unavailable', message: UNAVAILABLE },
      { field: 'productIds.2', code: 'product_unavailable', message: UNAVAILABLE },
    ])
    expect(repository.events).toEqual([])
    expect(await repository.listIds()).toEqual(['duo', 'camionero'])
  })

  it('un producto archivado falla en su índice y no se revisan grupos ni precio', async () => {
    const errors = await validationErrors(
      create.execute({ ...DUO_FIELDS, productIds: [IMPERIAL.id, ARCHIVADO.id], priceArs: 99999 }),
    )

    expect(errors).toEqual([
      { field: 'productIds.1', code: 'product_unavailable', message: UNAVAILABLE },
    ])
  })

  it('un producto sin stock sirve (el combo sale "Sin stock")', async () => {
    const created = await create.execute({
      ...DUO_FIELDS,
      productIds: [GALLETA.id, CANARIAS.id],
      priceArs: 33999,
    })

    expect(created).toMatchObject({ isSoldOut: true, isPurchasable: false })
  })

  it('dos productos del mismo grupo fallan en productIds con duplicate_group', async () => {
    const errors = await validationErrors(
      create.execute({ ...DUO_FIELDS, productIds: [IMPERIAL.id, CAMIONERO.id], priceArs: 50000 }),
    )

    expect(errors).toEqual([
      { field: 'productIds', code: 'duplicate_group', message: DISTINCT_GROUPS },
    ])
  })

  it('un precio igual a la suma falla en priceArs con la suma en el formato de la tienda', async () => {
    const errors = await validationErrors(create.execute({ ...DUO_FIELDS, priceArs: 68998 }))

    expect(errors).toEqual([
      {
        field: 'priceArs',
        code: 'price_not_below_sum',
        message: 'El precio del combo tiene que ser menor que la suma de los productos ($68.998)',
      },
    ])
  })

  it('Canarias $9.999 + Serena $12.500 a $22.499: grupos repetidos y precio, a la vez', async () => {
    const errors = await validationErrors(
      create.execute({ ...DUO_FIELDS, productIds: [CANARIAS.id, SERENA.id], priceArs: 22499 }),
    )

    expect(errors).toEqual([
      { field: 'productIds', code: 'duplicate_group', message: DISTINCT_GROUPS },
      {
        field: 'priceArs',
        code: 'price_not_below_sum',
        message: 'El precio del combo tiene que ser menor que la suma de los productos ($22.499)',
      },
    ])
    expect(repository.events).toEqual([])
  })

  it('las reglas valen también para los borradores', async () => {
    const errors = await validationErrors(
      create.execute({ ...DUO_FIELDS, status: 'draft', priceArs: 70000 }),
    )

    expect(errors).toMatchObject([{ field: 'priceArs', code: 'price_not_below_sum' }])
  })
})

describe('UpdateComboCommand (PATCH /admin/combos/{id})', () => {
  let repository: InMemoryComboRepository
  let update: UpdateComboCommand

  beforeEach(() => {
    repository = new InMemoryComboRepository(PRODUCTS, [DUO, CAMIONERO_Y_CANARIAS])
    update = new UpdateComboCommand(repository, new FixedPriceDisplay())
  })

  it('reemplaza todo, conserva la posición y guarda combo.changed updated', async () => {
    const updated = await update.execute('camionero', {
      name: 'Camionero con Serena',
      description: 'Otra yerba.',
      productIds: [SERENA.id, CAMIONERO.id],
      priceArs: 33000,
      status: 'draft',
    })

    expect(updated).toMatchObject({
      id: 'camionero',
      name: 'Camionero con Serena',
      description: 'Otra yerba.',
      priceArs: 33000,
      status: 'draft',
      position: 2,
      items: [{ productId: SERENA.id }, { productId: CAMIONERO.id }],
    })
    expect(repository.events).toEqual([
      {
        type: 'combo.changed',
        aggregateType: 'combo',
        aggregateId: 'camionero',
        payload: { comboId: 'camionero', change: 'updated' },
      },
    ])
  })

  it('un combo que no existe da 404 "No existe ese combo." antes de mirar los productos', async () => {
    const outcome = update.execute('no-existe', { ...DUO_FIELDS, productIds: ['x', 'y'] })

    await expect(outcome).rejects.toBeInstanceOf(ComboNotFoundError)
    await expect(outcome).rejects.toMatchObject({ status: 404, detail: 'No existe ese combo.' })
    expect(repository.events).toEqual([])
  })

  it('con reglas que fallan responde 422 y no cambia nada', async () => {
    const errors = await validationErrors(
      update.execute('duo', { ...DUO_FIELDS, name: 'Cambiado', priceArs: 68999 }),
    )

    expect(errors).toMatchObject([{ field: 'priceArs', code: 'price_not_below_sum' }])
    expect((await repository.findById('duo'))?.combo.name).toBe('Dúo Imperial')
    expect(repository.events).toEqual([])
  })
})

describe('DeleteComboCommand (DELETE /admin/combos/{id})', () => {
  it('borrar el segundo de cuatro deja las posiciones 1, 2 y 3 y guarda combo.changed deleted', async () => {
    const repository = new InMemoryComboRepository(PRODUCTS, [
      DUO,
      CAMIONERO_Y_CANARIAS,
      combo({ id: 'tercero', position: 3 }),
      combo({ id: 'cuarto', position: 4 }),
    ])

    await new DeleteComboCommand(repository).execute('camionero')

    expect(repository.positions()).toEqual({ duo: 1, tercero: 2, cuarto: 3 })
    expect(repository.events).toEqual([
      {
        type: 'combo.changed',
        aggregateType: 'combo',
        aggregateId: 'camionero',
        payload: { comboId: 'camionero', change: 'deleted' },
      },
    ])
  })

  it.each(['no-existe', ' '])('el combo "%s" no existe: 404 y ningún evento', async (id) => {
    const repository = new InMemoryComboRepository(PRODUCTS, [DUO])

    await expect(new DeleteComboCommand(repository).execute(id)).rejects.toBeInstanceOf(
      ComboNotFoundError,
    )
    expect(repository.events).toEqual([])
  })
})

describe('ReorderCombosCommand (PUT /admin/combos/order)', () => {
  let repository: InMemoryComboRepository
  let reorder: ReorderCombosCommand

  beforeEach(() => {
    repository = new InMemoryComboRepository(PRODUCTS, [
      DUO,
      CAMIONERO_Y_CANARIAS,
      combo({ id: 'tercero', position: 3 }),
    ])
    reorder = new ReorderCombosCommand(repository)
  })

  it('fija position = índice + 1 y guarda combo.changed reordered de todos los combos', async () => {
    await reorder.execute(['tercero', 'duo', 'camionero'])

    expect(repository.positions()).toEqual({ tercero: 1, duo: 2, camionero: 3 })
    expect(repository.events).toEqual([
      {
        type: 'combo.changed',
        aggregateType: 'combo',
        aggregateId: 'combos',
        payload: { comboId: null, change: 'reordered' },
      },
    ])
  })

  it.each([
    ['uno de más', ['tercero', 'duo', 'camionero', 'otro']],
    ['uno de menos', ['tercero', 'duo']],
    ['uno repetido', ['tercero', 'duo', 'duo']],
    ['uno que no existe', ['tercero', 'duo', 'no-existe']],
  ])('con %s responde 422 en ids y no cambia nada', async (_case, ids) => {
    const errors = await validationErrors(reorder.execute(ids))

    expect(errors).toEqual([{ field: 'ids', code: 'invalid_value', message: ORDER_INCOMPLETE }])
    expect(repository.positions()).toEqual({ duo: 1, camionero: 2, tercero: 3 })
    expect(repository.events).toEqual([])
  })
})

describe('ids en mayúsculas (un UUID no distingue mayúsculas, como la columna uuid)', () => {
  const MATE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01'
  const BOMBILLA_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02'
  const PRIMERO = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01'
  const SEGUNDO = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02'
  const MATE = product({ id: MATE_ID, slug: 'mate-uuid', priceArs: 30000 })
  const BOMBILLA = product({
    id: BOMBILLA_ID,
    slug: 'bombilla-uuid',
    priceArs: 20000,
    category: BOMBILLAS,
  })
  const FIELDS: ComboFields = {
    ...DUO_FIELDS,
    productIds: [MATE_ID.toUpperCase(), BOMBILLA_ID.toUpperCase()],
    priceArs: 45000,
  }
  let repository: InMemoryComboRepository

  beforeEach(() => {
    repository = new InMemoryComboRepository(
      [...PRODUCTS, MATE, BOMBILLA],
      [
        combo({ id: PRIMERO, position: 1, productIds: [MATE_ID, BOMBILLA_ID], priceArs: 45000 }),
        combo({ id: SEGUNDO, position: 2, productIds: [MATE_ID, BOMBILLA_ID], priceArs: 44000 }),
      ],
    )
  })

  it('POST con productIds de productos que existen, en mayúsculas: lo crea y los guarda en minúsculas', async () => {
    const created = await new CreateComboCommand(repository, new FixedPriceDisplay()).execute(
      FIELDS,
    )

    expect(created.items.map(({ productId }) => productId)).toEqual([MATE_ID, BOMBILLA_ID])
    expect((await repository.findById(created.id))?.combo.productIds).toEqual([
      MATE_ID,
      BOMBILLA_ID,
    ])
  })

  it('PATCH con el id y los productIds en mayúsculas: lo modifica y el evento lleva el id en minúsculas', async () => {
    const updated = await new UpdateComboCommand(repository, new FixedPriceDisplay()).execute(
      SEGUNDO.toUpperCase(),
      { ...FIELDS, name: 'Cambiado' },
    )

    expect(updated).toMatchObject({ id: SEGUNDO, name: 'Cambiado', position: 2 })
    expect((await repository.findById(SEGUNDO))?.combo.productIds).toEqual([MATE_ID, BOMBILLA_ID])
    expect(repository.events).toMatchObject([
      { aggregateId: SEGUNDO, payload: { comboId: SEGUNDO } },
    ])
  })

  it('DELETE con el id en mayúsculas: lo borra y el evento lleva el id en minúsculas', async () => {
    await new DeleteComboCommand(repository).execute(PRIMERO.toUpperCase())

    expect(repository.positions()).toEqual({ [SEGUNDO]: 1 })
    expect(repository.events).toMatchObject([
      { aggregateId: PRIMERO, payload: { comboId: PRIMERO } },
    ])
  })

  it('PUT /order con los ids en mayúsculas: los ordena', async () => {
    await new ReorderCombosCommand(repository).execute([
      SEGUNDO.toUpperCase(),
      PRIMERO.toUpperCase(),
    ])

    expect(repository.positions()).toEqual({ [SEGUNDO]: 1, [PRIMERO]: 2 })
  })

  it('el mismo combo dos veces (una en mayúsculas) sigue siendo un orden inválido', async () => {
    const errors = await validationErrors(
      new ReorderCombosCommand(repository).execute([PRIMERO, PRIMERO.toUpperCase()]),
    )

    expect(errors).toEqual([{ field: 'ids', code: 'invalid_value', message: ORDER_INCOMPLETE }])
  })
})
