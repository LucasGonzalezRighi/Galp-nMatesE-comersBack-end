import { ListCategoriesQuery } from './list-categories.query'

/**
 * Líneas del dashboard (`GET /admin/categories`): las mismas que `GET /categories`, por
 * `position` y con los productos publicados, pero leídas de Postgres sin caché (el módulo la arma
 * con el repositorio del dashboard) para que el dashboard vea sus cambios al instante.
 */
export class ListAdminCategoriesQuery extends ListCategoriesQuery {}
