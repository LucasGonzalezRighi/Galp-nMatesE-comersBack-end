import { Module } from '@nestjs/common'

import { ContentModule } from '../content/content.module'
import { SettingsModule } from '../settings/settings.module'
import {
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from './application/ports/category.repository.port'
import { PRICE_DISPLAY_PORT, type PriceDisplayPort } from './application/ports/price-display.port'
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from './application/ports/product.repository.port'
import { PRODUCT_TABS_PORT, type ProductTabsPort } from './application/ports/product-tabs.port'
import { GetProductQuery } from './application/queries/get-product.query'
import { GetRelatedProductsQuery } from './application/queries/get-related-products.query'
import { ListCategoriesQuery } from './application/queries/list-categories.query'
import { ListProductsQuery } from './application/queries/list-products.query'
import { CachedCategoryRepository } from './infrastructure/cached-category.repository'
import { CachedProductRepository } from './infrastructure/cached-product.repository'
import { ContentProductTabsAdapter } from './infrastructure/content-product-tabs.adapter'
import { PrismaCategoryRepository } from './infrastructure/prisma-category.repository'
import { PrismaProductRepository } from './infrastructure/prisma-product.repository'
import { SettingsPriceDisplayAdapter } from './infrastructure/settings-price-display.adapter'

/**
 * Catálogo: líneas y productos publicados. Los repositorios Prisma van decorados con la caché
 * (`catalog:*`, 60 s); el precio sin IVA sale de `settings` y las pestañas de `content`.
 *
 * Exporta las queries (para los controladores) y {@link PRODUCT_REPOSITORY} (para que otros
 * módulos, como `reviews`, resuelvan un producto por slug).
 */
@Module({
  imports: [SettingsModule, ContentModule],
  providers: [
    PrismaProductRepository,
    PrismaCategoryRepository,
    { provide: PRODUCT_REPOSITORY, useClass: CachedProductRepository },
    { provide: CATEGORY_REPOSITORY, useClass: CachedCategoryRepository },
    { provide: PRICE_DISPLAY_PORT, useClass: SettingsPriceDisplayAdapter },
    { provide: PRODUCT_TABS_PORT, useClass: ContentProductTabsAdapter },
    {
      provide: ListCategoriesQuery,
      useFactory: (categories: CategoryRepository) => new ListCategoriesQuery(categories),
      inject: [CATEGORY_REPOSITORY],
    },
    {
      provide: ListProductsQuery,
      useFactory: (products: ProductRepository, prices: PriceDisplayPort) =>
        new ListProductsQuery(products, prices),
      inject: [PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT],
    },
    {
      provide: GetProductQuery,
      useFactory: (products: ProductRepository, prices: PriceDisplayPort, tabs: ProductTabsPort) =>
        new GetProductQuery(products, prices, tabs),
      inject: [PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT],
    },
    {
      provide: GetRelatedProductsQuery,
      useFactory: (products: ProductRepository, prices: PriceDisplayPort) =>
        new GetRelatedProductsQuery(products, prices),
      inject: [PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT],
    },
  ],
  exports: [
    ListCategoriesQuery,
    ListProductsQuery,
    GetProductQuery,
    GetRelatedProductsQuery,
    PRODUCT_REPOSITORY,
  ],
})
export class CatalogModule {}
