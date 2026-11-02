// Importa las fixtures del mock del front y escribe `prisma/seed-data/*.ts` como datos planos
// tipados, en términos del back (slugs en vez de ids del mock). Se corre a mano cuando cambian
// las fixtures y el resultado se commitea: el seed no importa nada del front en runtime.
//
//   node scripts/import-fixtures.mjs
//   FIXTURES_PATH=/ruta/a/fixtures/index.ts node scripts/import-fixtures.mjs
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as prettier from 'prettier'
import { tsImport } from 'tsx/esm/api'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'prisma', 'seed-data')

/** `index.ts` de las fixtures del front, al lado de este repo. */
const DEFAULT_FIXTURES_PATH = path.resolve(
  ROOT,
  '../frontend/packages/api-client/src/mock/fixtures/index.ts',
)

/**
 * Corta el import si algo de las fixtures no tiene la forma esperada.
 *
 * @param {boolean} condition - Lo que tiene que cumplirse.
 * @param {string} message - Error en español si no se cumple.
 * @returns {asserts condition}
 */
function check(condition, message) {
  if (!condition) throw new Error(`Fixtures inválidas: ${message}`)
}

/**
 * Copia una foto del mock con solo los campos que guarda `media_assets`.
 *
 * @param {{ publicId: string, url: string, width: number, height: number, alt: string }} image
 */
function toImage(image) {
  const { publicId, url, width, height, alt } = image
  return { publicId, url, width, height, alt }
}

/**
 * Pasa las fixtures del mock a los datos del seed.
 *
 * @param {Record<string, any>} fixtures - Módulo `index.ts` de las fixtures del front.
 */
function mapFixtures(fixtures) {
  const { FIXTURE_CATEGORIES, FIXTURE_PRODUCTS, FIXTURE_REVIEWS, FIXTURE_CONTENT } = fixtures
  const { FIXTURE_SETTINGS } = fixtures
  check(Array.isArray(FIXTURE_CATEGORIES), 'falta FIXTURE_CATEGORIES')
  check(Array.isArray(FIXTURE_PRODUCTS), 'falta FIXTURE_PRODUCTS')
  check(Array.isArray(FIXTURE_REVIEWS), 'falta FIXTURE_REVIEWS')
  check(FIXTURE_CONTENT !== undefined, 'falta FIXTURE_CONTENT')
  check(FIXTURE_SETTINGS !== undefined, 'falta FIXTURE_SETTINGS')

  /** @type {Map<string, string>} id del mock → slug */
  const categorySlugs = new Map(FIXTURE_CATEGORIES.map((c) => [c.id, c.slug]))
  /** @type {Map<string, string>} id del mock → slug */
  const productSlugs = new Map(FIXTURE_PRODUCTS.map((p) => [p.id, p.slug]))

  const categories = [...FIXTURE_CATEGORIES]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      group: c.group,
      blurb: c.blurb,
      position: c.position,
      image: c.image === null ? null : toImage(c.image),
    }))

  const products = [...FIXTURE_PRODUCTS]
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => {
      const categorySlug = categorySlugs.get(p.categoryId)
      check(categorySlug !== undefined, `el producto ${p.slug} apunta a ${p.categoryId}`)
      return {
        sequence: p.sequence,
        slug: p.slug,
        categorySlug,
        name: p.name,
        description: p.description,
        priceArs: p.priceArs,
        status: p.status,
        featured: p.featured,
        onHand: p.stock,
        images: p.images.map(toImage),
        tabsOverride: p.tabsOverride,
        createdAt: p.createdAt,
      }
    })

  const reviews = FIXTURE_REVIEWS.map((r) => {
    const productSlug = productSlugs.get(r.productId)
    check(productSlug !== undefined, `la reseña ${r.id} apunta a ${r.productId}`)
    return {
      productSlug,
      authorName: r.authorName,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      status: r.status,
      featured: r.featured,
    }
  })

  const content = [
    { key: 'home', data: FIXTURE_CONTENT.home },
    { key: 'about', data: FIXTURE_CONTENT.about },
    { key: 'faq', data: FIXTURE_CONTENT.faq },
    { key: 'footer', data: FIXTURE_CONTENT.footer },
    { key: 'product-tabs', data: FIXTURE_CONTENT.productTabs },
    { key: 'legal-terms', data: FIXTURE_CONTENT.legal?.terms },
    { key: 'legal-privacy', data: FIXTURE_CONTENT.legal?.privacy },
  ]
  for (const block of content) check(block.data !== undefined, `falta el contenido ${block.key}`)

  const s = FIXTURE_SETTINGS
  const settings = {
    kitDiscountPercent: s.kitDiscountPercent,
    installmentsMax: s.installments.maxWithoutInterest,
    installmentsShowOnProduct: s.installments.showOnProduct,
    contactEmail: s.contactEmail,
    lowStockThreshold: s.lowStockThreshold,
    vatRatePercent: s.vatRatePercent,
    showNetPrice: s.priceDisplay.showNetPrice,
    seller: s.seller,
  }
  const shippingOptions = s.shippingOptions.map((o) => ({
    method: o.method,
    label: o.label,
    costArs: o.costArs,
    eta: o.eta,
    enabled: o.enabled,
  }))

  return { categories, products, reviews, content, settings, shippingOptions }
}

/**
 * Arma el código de un archivo de `prisma/seed-data/` y lo formatea con la config de Prettier.
 *
 * @param {string} file - Nombre del archivo (`categories.ts`…).
 * @param {{ name: string, type: string, doc: string, value: unknown }[]} exports - Constantes.
 */
async function render(file, exports) {
  const types = [...new Set(exports.map((e) => e.type.replace(/^readonly |\[\]$/g, '')))]
  const body = exports
    .map((e) => `/** ${e.doc} */\nexport const ${e.name}: ${e.type} = ${JSON.stringify(e.value)}`)
    .join('\n\n')
  const source = [
    '// Generado por scripts/import-fixtures.mjs desde las fixtures del front: no editar a mano.',
    `import type { ${types.sort().join(', ')} } from './types'`,
    '',
    body,
    '',
  ].join('\n')
  const filepath = path.join(OUT_DIR, file)
  const options = (await prettier.resolveConfig(filepath)) ?? {}
  return { filepath, code: await prettier.format(source, { ...options, filepath }) }
}

async function main() {
  const fixturesPath = path.resolve(process.env.FIXTURES_PATH ?? DEFAULT_FIXTURES_PATH)
  const fixtures = await tsImport(pathToFileURL(fixturesPath).href, import.meta.url)
  const data = mapFixtures(fixtures)

  const files = await Promise.all([
    render('categories.ts', [
      {
        name: 'SEED_CATEGORIES',
        type: 'readonly SeedCategory[]',
        doc: 'Líneas del catálogo, por `position`.',
        value: data.categories,
      },
    ]),
    render('products.ts', [
      {
        name: 'SEED_PRODUCTS',
        type: 'readonly SeedProduct[]',
        doc: 'Productos del diseño, por `sequence`, con su stock y sus fotos.',
        value: data.products,
      },
    ]),
    render('reviews.ts', [
      {
        name: 'SEED_REVIEWS',
        type: 'readonly SeedReview[]',
        doc: 'Reseñas del diseño, con medias estrellas y destacadas.',
        value: data.reviews,
      },
    ]),
    render('content.ts', [
      {
        name: 'SEED_CONTENT_BLOCKS',
        type: 'readonly SeedContentBlock[]',
        doc: 'Contenidos editables, uno por clave.',
        value: data.content,
      },
    ]),
    render('settings.ts', [
      {
        name: 'SEED_SETTINGS',
        type: 'SeedSettings',
        doc: 'Ajustes de la tienda (fila `id = 1`).',
        value: data.settings,
      },
      {
        name: 'SEED_SHIPPING_OPTIONS',
        type: 'readonly SeedShippingOption[]',
        doc: 'Opciones de envío del checkout, en el orden en que se muestran.',
        value: data.shippingOptions,
      },
    ]),
  ])
  for (const { filepath, code } of files) await writeFile(filepath, code)

  const featured = data.reviews.filter((r) => r.featured).length
  const soldOut = data.products.filter((p) => p.onHand === 0).length
  process.stdout.write(
    `Fixtures importadas desde ${fixturesPath}:\n` +
      `  ${String(data.categories.length)} categorías, ${String(data.products.length)} productos` +
      ` (${String(soldOut)} agotados), ${String(data.reviews.length)} reseñas` +
      ` (${String(featured)} destacadas), ${String(data.content.length)} contenidos,` +
      ` ${String(data.shippingOptions.length)} opciones de envío.\n`,
  )
}

main().catch((/** @type {unknown} */ error) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`No se pudieron importar las fixtures: ${detail}\n`)
  process.exitCode = 1
})
