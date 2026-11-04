// Operaciones y casos de validación de los contenidos y los ajustes del dashboard (Task 1 de B6).
// Los suman `openapi.contract.spec.ts` y `validation-cases.contract.spec.ts`.

import {
  AboutContentInputDto,
  FaqContentInputDto,
  FooterContentInputDto,
  HomeContentInputDto,
  LegalContentInputDto,
  ProductTabsContentInputDto,
} from '../../../src/modules/content/interface/dto/content-input.dto'
import { AdminSettingsInputDto } from '../../../src/modules/settings/interface/dto/settings-input.dto'
import { ImageInputDto } from '../../../src/shared/infrastructure/http/image-input.dto'
import {
  type Check,
  type Mapping,
  type ValidationCase,
  wholeCase,
  withoutNulls,
} from '../validation-cases.support'

/** Operaciones de contenidos y ajustes del dashboard que el back ya implementa. */
export const CONTENT_PATHS: readonly string[] = [
  'GET /admin/content/home',
  'PUT /admin/content/home',
  'GET /admin/content/about',
  'PUT /admin/content/about',
  'GET /admin/content/faq',
  'PUT /admin/content/faq',
  'GET /admin/content/footer',
  'PUT /admin/content/footer',
  'GET /admin/content/product-tabs',
  'PUT /admin/content/product-tabs',
  'GET /admin/content/legal/{document}',
  'PUT /admin/content/legal/{document}',
  'GET /admin/settings',
  'PUT /admin/settings',
]

/**
 * Como {@link wholeCase}, pero la salida esperada también pierde los `null` de la raíz: la spec
 * se los saca a lo que da el DTO (`withoutNulls`), y en estos formularios un campo de la raíz que
 * queda en `null` (`consumerDefenseUrl` vacío del pie) es parte de la salida del front.
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

/** DTOs de contenidos, ajustes y fotos contra los casos compartidos. */
export const CONTENT_MAPPINGS: readonly Mapping[] = [
  {
    name: 'HomeContentInputDto (homeContentFormSchema)',
    dto: HomeContentInputDto,
    check: wholeFormCase('homeContentFormSchema'),
  },
  {
    name: 'AboutContentInputDto (aboutContentFormSchema)',
    dto: AboutContentInputDto,
    check: wholeFormCase('aboutContentFormSchema'),
  },
  {
    name: 'FaqContentInputDto (faqContentFormSchema)',
    dto: FaqContentInputDto,
    check: wholeFormCase('faqContentFormSchema'),
  },
  {
    name: 'FooterContentInputDto (footerContentFormSchema)',
    dto: FooterContentInputDto,
    check: wholeFormCase('footerContentFormSchema'),
  },
  {
    name: 'ProductTabsContentInputDto (productTabsContentFormSchema)',
    dto: ProductTabsContentInputDto,
    check: wholeFormCase('productTabsContentFormSchema'),
  },
  {
    name: 'LegalContentInputDto (legalContentFormSchema)',
    dto: LegalContentInputDto,
    check: wholeFormCase('legalContentFormSchema'),
  },
  {
    name: 'AdminSettingsInputDto (settingsFormSchema)',
    dto: AdminSettingsInputDto,
    check: wholeFormCase('settingsFormSchema'),
  },
  {
    name: 'ImageInputDto (imageFormSchema)',
    dto: ImageInputDto,
    check: wholeFormCase('imageFormSchema'),
  },
]
