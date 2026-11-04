// Esquemas de respuesta de los productos del dashboard que no salen de una clase, solo para
// Swagger: `AdminProduct` es un `allOf` de `ProductDetail` (como en el contrato) y
// `AdminProductPage` lo lista. `ProductStatus` sale del `enumName` de la query y
// `ProductTabsOverride` de su DTO. El test de contrato los compara.

import { MAX_PAGE_SIZE } from '../../../../shared/infrastructure/http/page.dto'
import {
  nullableRef,
  type OpenApiSchema,
  schemaRef,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'

/** Esquemas de los productos del dashboard (`AdminProduct`, `AdminProductPage`). */
export const CATALOG_ADMIN_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  AdminProduct: {
    description:
      'Producto como lo ve el dashboard: todo lo de la ficha más lo que la tienda no muestra.',
    allOf: [
      schemaRef('ProductDetail'),
      {
        type: 'object',
        required: [
          'status',
          'stock',
          'sequence',
          'tabsOverride',
          'previousSlugs',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          status: schemaRef('ProductStatus'),
          stock: {
            type: 'integer',
            minimum: 0,
            maximum: 9999,
            description: 'Unidades disponibles (lo que hay menos lo reservado).',
          },
          sequence: { type: 'integer', minimum: 1, description: 'Número correlativo.' },
          tabsOverride: nullableRef('ProductTabsOverride'),
          previousSlugs: {
            type: 'array',
            description: 'Slugs anteriores del producto, del más viejo al más nuevo.',
            items: { type: 'string', maxLength: SLUG_MAX_LENGTH, pattern: SLUG_PATTERN.source },
          },
          createdAt: { type: 'string', format: 'date-time', description: 'Alta, en UTC.' },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Última modificación, en UTC.',
          },
        },
      },
    ],
  },
  AdminProductPage: {
    type: 'object',
    description: 'Página de productos del dashboard.',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: schemaRef('AdminProduct') },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
      total: { type: 'integer', minimum: 0 },
    },
  },
}
