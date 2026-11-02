import { Inject, Injectable } from '@nestjs/common'

import { GetContentQuery } from '../../content/application/queries/get-content.query'
import type { ProductTabsPort, ProductTabsTexts } from '../application/ports/product-tabs.port'

/** Pestañas de la ficha, leídas del contenido `product-tabs` del módulo `content` (300 s). */
@Injectable()
export class ContentProductTabsAdapter implements ProductTabsPort {
  /** @param content - Contenidos editables. */
  constructor(@Inject(GetContentQuery) private readonly content: GetContentQuery) {}

  /** {@inheritDoc ProductTabsPort.get} */
  async get(): Promise<ProductTabsTexts> {
    const tabs = await this.content.execute('product-tabs')
    if (tabs === null) {
      throw new Error('Falta el contenido "product-tabs": corré el seed (npm run db:seed).')
    }
    return tabs
  }
}
