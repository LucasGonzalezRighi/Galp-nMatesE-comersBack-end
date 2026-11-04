import { GetContentQuery } from './get-content.query'

/**
 * Contenido editable por clave para el dashboard (`GET /admin/content/*`): la misma lectura que
 * {@link GetContentQuery}, pero cableada a Postgres sin caché (Ruling B-79), así el dashboard nunca
 * ve un valor viejo.
 */
export class GetAdminContentQuery extends GetContentQuery {}
