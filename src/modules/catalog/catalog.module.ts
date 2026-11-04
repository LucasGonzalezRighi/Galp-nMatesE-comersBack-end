import { Module } from '@nestjs/common'

import { ContentModule } from '../content/content.module'
import { SettingsModule } from '../settings/settings.module'
import { CreateComboCommand } from './application/commands/create-combo.command'
import { DeleteComboCommand } from './application/commands/delete-combo.command'
import { ReorderCombosCommand } from './application/commands/reorder-combos.command'
import { UpdateComboCommand } from './application/commands/update-combo.command'
import {
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from './application/ports/category.repository.port'
import { COMBO_REPOSITORY, type ComboRepository } from './application/ports/combo.repository.port'
import { PRICE_DISPLAY_PORT, type PriceDisplayPort } from './application/ports/price-display.port'
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from './application/ports/product.repository.port'
import { PRODUCT_TABS_PORT, type ProductTabsPort } from './application/ports/product-tabs.port'
import { GetProductQuery } from './application/queries/get-product.query'
import { GetRelatedProductsQuery } from './application/queries/get-related-products.query'
import { ListAdminCombosQuery } from './application/queries/list-admin-combos.query'
import { ListCategoriesQuery } from './application/queries/list-categories.query'
import { ListCombosQuery } from './application/queries/list-combos.query'
import { ListProductsQuery } from './application/queries/list-products.query'
import { CachedCategoryRepository } from './infrastructure/cached-category.repository'
import { CachedProductRepository } from './infrastructure/cached-product.repository'
import { ContentProductTabsAdapter } from './infrastructure/content-product-tabs.adapter'
import { PrismaCategoryRepository } from './infrastructure/prisma-category.repository'
import { PrismaComboRepository } from './infrastructure/prisma-combo.repository'
import { PrismaProductRepository } from './infrastructure/prisma-product.repository'
import { SettingsPriceDisplayAdapter } from './infrastructure/settings-price-display.adapter'
import { AdminCombosController } from './interface/admin-combos.controller'
import { CategoriesController } from './interface/categories.controller'
import { CombosController } from './interface/combos.controller'
import { ProductsController } from './interface/products.controller'

/**
 * Catálogo: líneas, productos publicados y combos. Los repositorios Prisma de líneas y productos
 * van decorados con la caché (`catalog:*`, 60 s); los combos leen Postgres siempre (sus derivados
 * dependen del stock y de los precios vigentes) y cada escritura guarda su `combo.changed` en el
 * outbox para avisar a la tienda. El precio sin IVA sale de `settings` y las pestañas de
 * `content`.
 *
 * Sirve `GET /categories`, `GET /products…`, `GET /combos` y `/admin/combos…`. Exporta las
 * queries y {@link PRODUCT_REPOSITORY} (para que otros módulos, como `reviews`, resuelvan un
 * producto por slug).
 */
@Module({
  imports: [SettingsModule, ContentModule],
  controllers: [CategoriesController, ProductsController, CombosController, AdminCombosController],
  providers: [
    PrismaProductRepository,
    PrismaCategoryRepository,
    { provide: COMBO_REPOSITORY, useClass: PrismaComboRepository },
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
    {
      provide: ListCombosQuery,
      useFactory: (combos: ComboRepository, prices: PriceDisplayPort) =>
        new ListCombosQuery(combos, prices),
      inject: [COMBO_REPOSITORY, PRICE_DISPLAY_PORT],
    },
    {
      provide: ListAdminCombosQuery,
      useFactory: (combos: ComboRepository, prices: PriceDisplayPort) =>
        new ListAdminCombosQuery(combos, prices),
      inject: [COMBO_REPOSITORY, PRICE_DISPLAY_PORT],
    },
    {
      provide: CreateComboCommand,
      useFactory: (combos: ComboRepository, prices: PriceDisplayPort) =>
        new CreateComboCommand(combos, prices),
      inject: [COMBO_REPOSITORY, PRICE_DISPLAY_PORT],
    },
    {
      provide: UpdateComboCommand,
      useFactory: (combos: ComboRepository, prices: PriceDisplayPort) =>
        new UpdateComboCommand(combos, prices),
      inject: [COMBO_REPOSITORY, PRICE_DISPLAY_PORT],
    },
    {
      provide: DeleteComboCommand,
      useFactory: (combos: ComboRepository) => new DeleteComboCommand(combos),
      inject: [COMBO_REPOSITORY],
    },
    {
      provide: ReorderCombosCommand,
      useFactory: (combos: ComboRepository) => new ReorderCombosCommand(combos),
      inject: [COMBO_REPOSITORY],
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
