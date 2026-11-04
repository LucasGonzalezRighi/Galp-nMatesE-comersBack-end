import { Module } from '@nestjs/common'

import { ContentModule } from '../content/content.module'
import { MEDIA_STORAGE, type MediaStorage } from '../media/application/ports/media-storage.port'
import { MediaModule } from '../media/media.module'
import { SettingsModule } from '../settings/settings.module'
import { ArchiveProductCommand } from './application/commands/archive-product.command'
import { CreateCategoryCommand } from './application/commands/create-category.command'
import { CreateComboCommand } from './application/commands/create-combo.command'
import { CreateProductCommand } from './application/commands/create-product.command'
import { DeleteCategoryCommand } from './application/commands/delete-category.command'
import { DeleteComboCommand } from './application/commands/delete-combo.command'
import { ReorderCategoriesCommand } from './application/commands/reorder-categories.command'
import { ReorderCombosCommand } from './application/commands/reorder-combos.command'
import { UpdateCategoryCommand } from './application/commands/update-category.command'
import { UpdateComboCommand } from './application/commands/update-combo.command'
import { UpdateProductCommand } from './application/commands/update-product.command'
import {
  ADMIN_CATEGORY_REPOSITORY,
  type AdminCategoryRepository,
} from './application/ports/admin-category.repository.port'
import {
  ADMIN_PRODUCT_REPOSITORY,
  type AdminProductRepository,
} from './application/ports/admin-product.repository.port'
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
import { GetAdminProductQuery } from './application/queries/get-admin-product.query'
import { GetProductQuery } from './application/queries/get-product.query'
import { GetRelatedProductsQuery } from './application/queries/get-related-products.query'
import { ListAdminCategoriesQuery } from './application/queries/list-admin-categories.query'
import { ListAdminCombosQuery } from './application/queries/list-admin-combos.query'
import { ListAdminProductsQuery } from './application/queries/list-admin-products.query'
import { ListCategoriesQuery } from './application/queries/list-categories.query'
import { ListCombosQuery } from './application/queries/list-combos.query'
import { ListProductsQuery } from './application/queries/list-products.query'
import { CachedCategoryRepository } from './infrastructure/cached-category.repository'
import { CachedProductRepository } from './infrastructure/cached-product.repository'
import { ContentProductTabsAdapter } from './infrastructure/content-product-tabs.adapter'
import { PrismaAdminCategoryRepository } from './infrastructure/prisma-admin-category.repository'
import { PrismaAdminProductRepository } from './infrastructure/prisma-admin-product.repository'
import { PrismaCategoryRepository } from './infrastructure/prisma-category.repository'
import { PrismaComboRepository } from './infrastructure/prisma-combo.repository'
import { PrismaProductRepository } from './infrastructure/prisma-product.repository'
import { SettingsPriceDisplayAdapter } from './infrastructure/settings-price-display.adapter'
import { AdminCategoriesController } from './interface/admin-categories.controller'
import { AdminCombosController } from './interface/admin-combos.controller'
import { AdminProductsController } from './interface/admin-products.controller'
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
 * Sirve `GET /categories`, `GET /products…`, `GET /combos`, `/admin/combos…`, `/admin/products…`
 * y `/admin/categories…` (el dashboard lee Postgres sin caché y cada escritura sube la versión de
 * la caché después del commit). Importa `MediaModule` (la firma de las subidas y dónde viven las
 * fotos nuevas). Exporta las queries y {@link PRODUCT_REPOSITORY} (para que otros módulos, como
 * `reviews`, resuelvan un producto por slug).
 */
@Module({
  imports: [SettingsModule, ContentModule, MediaModule],
  controllers: [
    CategoriesController,
    ProductsController,
    CombosController,
    AdminCombosController,
    AdminProductsController,
    AdminCategoriesController,
  ],
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
    { provide: ADMIN_PRODUCT_REPOSITORY, useClass: PrismaAdminProductRepository },
    { provide: ADMIN_CATEGORY_REPOSITORY, useClass: PrismaAdminCategoryRepository },
    {
      provide: ListAdminProductsQuery,
      useFactory: (
        products: AdminProductRepository,
        prices: PriceDisplayPort,
        tabs: ProductTabsPort,
      ) => new ListAdminProductsQuery(products, prices, tabs),
      inject: [ADMIN_PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT],
    },
    {
      provide: GetAdminProductQuery,
      useFactory: (
        products: AdminProductRepository,
        prices: PriceDisplayPort,
        tabs: ProductTabsPort,
      ) => new GetAdminProductQuery(products, prices, tabs),
      inject: [ADMIN_PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT],
    },
    {
      provide: CreateProductCommand,
      useFactory: (
        products: AdminProductRepository,
        prices: PriceDisplayPort,
        tabs: ProductTabsPort,
        media: MediaStorage,
      ) => new CreateProductCommand(products, prices, tabs, media.cloudName),
      inject: [ADMIN_PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT, MEDIA_STORAGE],
    },
    {
      provide: UpdateProductCommand,
      useFactory: (
        products: AdminProductRepository,
        prices: PriceDisplayPort,
        tabs: ProductTabsPort,
        media: MediaStorage,
      ) => new UpdateProductCommand(products, prices, tabs, media.cloudName),
      inject: [ADMIN_PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT, MEDIA_STORAGE],
    },
    {
      provide: ArchiveProductCommand,
      useFactory: (
        products: AdminProductRepository,
        prices: PriceDisplayPort,
        tabs: ProductTabsPort,
      ) => new ArchiveProductCommand(products, prices, tabs),
      inject: [ADMIN_PRODUCT_REPOSITORY, PRICE_DISPLAY_PORT, PRODUCT_TABS_PORT],
    },
    {
      provide: ListAdminCategoriesQuery,
      useFactory: (categories: AdminCategoryRepository) => new ListAdminCategoriesQuery(categories),
      inject: [ADMIN_CATEGORY_REPOSITORY],
    },
    {
      provide: CreateCategoryCommand,
      useFactory: (categories: AdminCategoryRepository, media: MediaStorage) =>
        new CreateCategoryCommand(categories, media.cloudName),
      inject: [ADMIN_CATEGORY_REPOSITORY, MEDIA_STORAGE],
    },
    {
      provide: UpdateCategoryCommand,
      useFactory: (categories: AdminCategoryRepository, media: MediaStorage) =>
        new UpdateCategoryCommand(categories, media.cloudName),
      inject: [ADMIN_CATEGORY_REPOSITORY, MEDIA_STORAGE],
    },
    {
      provide: DeleteCategoryCommand,
      useFactory: (categories: AdminCategoryRepository) => new DeleteCategoryCommand(categories),
      inject: [ADMIN_CATEGORY_REPOSITORY],
    },
    {
      provide: ReorderCategoriesCommand,
      useFactory: (categories: AdminCategoryRepository) => new ReorderCategoriesCommand(categories),
      inject: [ADMIN_CATEGORY_REPOSITORY],
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
