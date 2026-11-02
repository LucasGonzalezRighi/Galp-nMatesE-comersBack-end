# ADR 0002 · Prisma 7 con el driver adapter `pg`

- **Estado:** aceptada (aplicada en B1, 2026-11-02).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §2, §4 y §10.

## Contexto

La spec elige PostgreSQL y Prisma, **solo en los adaptadores de infraestructura** (ADR 0001).
Prisma 7 cambia la forma de usarlo: el cliente nuevo (`prisma-client`) se genera dentro del
proyecto, la conexión pasa por un _driver adapter_ (sin el motor de Rust) y la URL de la base sale
de `prisma.config.ts`, no del `schema.prisma`. Al instalar, el tag `latest` de `prisma` apuntaba a
una RC de la 8.

## Decisión

1. **Versión fija `prisma`, `@prisma/client` y `@prisma/adapter-pg` 7.10.1** (sin `^`, controlada
   por `scripts/check-dependency-versions.mjs`), con `pg` 8.23.1. No se usa la 8 RC.
2. **Generator `prisma-client`** con `output = "../src/generated/prisma"`, `moduleFormat = "cjs"`
   y `runtime = "nodejs"`. El cliente generado no se versiona (`.gitignore`): lo regenera
   `postinstall` (`prisma generate`), y queda fuera de ESLint y Prettier. El código importa de
   `src/generated/prisma/client`, no de `@prisma/client`.
3. **`PrismaService extends PrismaClient`** con `new PrismaPg(pool)` sobre un `pg.Pool` propio
   creado con `DATABASE_URL` (token `ENV`, configuración validada con zod). `onModuleDestroy`
   desconecta y cierra el pool.
4. **Postgres es crítico:** con el adapter, `$connect()` no abre ninguna conexión, así que
   `onModuleInit` hace `SELECT 1` y, si falla, la API no arranca (error en español con la causa).
   `/health` informa `database` (503 si cae) y `redis` (`degraded` si cae, la API sigue).
5. **`prisma.config.ts`** carga `.env` si existe (el entorno gana), toma `DATABASE_URL` (vacía no
   rompe `prisma generate`) y declara el seed (`tsx prisma/seed.ts`).
6. **Migraciones versionadas** (`prisma migrate dev` en desarrollo, `migrate deploy` en CI y
   producción), con SQL a mano donde Prisma no llega: extensión `citext`, `CHECK` de stock,
   rating en medias estrellas y `settings` de una sola fila, e índice parcial del outbox.
   `prisma` va en `dependencies` porque `migrate deploy` se usa también en producción.
7. **Convenciones del esquema:** ids `uuid(7)`, fechas `timestamptz(3)`, montos enteros `_ars`,
   tablas y columnas `snake_case` con `@map`/`@@map`. Los `Decimal` (rating, IVA) se pasan a
   `number` en los mappers.

## Consecuencias

- Sin binarios del motor de Prisma: la imagen de producción es más liviana y el pool es el de
  `pg`, configurable como cualquier app de Node.
- El SQL que Prisma no expresa bien (búsqueda sin acentos con `translate`, orden con
  `COLLATE "es-x-icu"`, `OFFSET` como `bigint`) se escribe con `Prisma.sql` en el repositorio, con
  parámetros (sin concatenar texto).
- `npm install` tiene que correr `postinstall`; sin el cliente generado no compila nada.
- Pendiente para B8: `connectionTimeoutMillis` en el pool (hoy, con una base que no contesta,
  una consulta puede colgarse hasta el timeout del sistema).

## Alternativas descartadas

- **Prisma 6 con el motor de Rust:** es la línea vieja; la 7 es la estable al instalar.
- **Prisma 8 (RC):** no es estable.
- **Generator `prisma-client-js` en `node_modules`:** es la forma vieja y esconde el cliente fuera
  del proyecto.
