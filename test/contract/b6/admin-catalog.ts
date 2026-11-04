// Operaciones y casos de validación de productos, líneas y fotos del dashboard (Task 6 de B6).
// Los suman `openapi.contract.spec.ts` y `validation-cases.contract.spec.ts`.

import { AdminProductInputDto } from '../../../src/modules/catalog/interface/dto/admin-product-input.dto'
import { CategoryOrderInputDto } from '../../../src/modules/catalog/interface/dto/category-input.dto'
import { MediaSignatureInputDto } from '../../../src/modules/media/interface/dto/media-signature.dto'
import {
  type Check,
  type Mapping,
  type ValidationCase,
  wholeCase,
  withoutNulls,
} from '../validation-cases.support'

/** Operaciones de productos, líneas y fotos del dashboard que el back ya implementa. */
export const ADMIN_CATALOG_PATHS: readonly string[] = [
  'GET /admin/products',
  'POST /admin/products',
  'GET /admin/products/{id}',
  'PATCH /admin/products/{id}',
  'POST /admin/products/{id}/archive',
  'GET /admin/categories',
  'POST /admin/categories',
  'PUT /admin/categories/order',
  'PATCH /admin/categories/{id}',
  'DELETE /admin/categories/{id}',
  'POST /admin/media/signature',
]

/**
 * Como {@link wholeCase}, pero la salida esperada también pierde los `null` de la raíz: la spec se
 * los saca a lo que da el DTO (`withoutNulls`), y en el formulario de productos el precio "a
 * consultar" (`priceArs: null`) es parte de la salida del front.
 *
 * @param schema - Nombre del schema del front.
 * @returns El armado del chequeo de cada caso de ese schema.
 */
function wholeFormCase(schema: string): (validationCase: ValidationCase) => Check | null {
  const check = wholeCase(schema)
  return (validationCase) => {
    const built = check(validationCase)
    if (built === null) return null
    return {
      ...built,
      output: built.output === undefined ? undefined : withoutNulls(built.output),
    }
  }
}

/** DTOs de productos, líneas y fotos del dashboard contra los casos compartidos. */
export const ADMIN_CATALOG_MAPPINGS: readonly Mapping[] = [
  {
    // Los 41 casos del formulario de productos más los 5 de cueros del contrato de la ronda.
    name: 'AdminProductInputDto (productFormSchema)',
    dto: AdminProductInputDto,
    check: wholeFormCase('productFormSchema'),
  },
  {
    name: 'CategoryOrderInputDto (categoryOrderSchema)',
    dto: CategoryOrderInputDto,
    check: wholeCase('categoryOrderSchema'),
  },
  {
    name: 'MediaSignatureInputDto (mediaSignatureSchema)',
    dto: MediaSignatureInputDto,
    check: wholeCase('mediaSignatureSchema'),
  },
]
