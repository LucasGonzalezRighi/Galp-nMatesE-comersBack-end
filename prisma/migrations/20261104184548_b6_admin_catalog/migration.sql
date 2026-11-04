-- B6 · Productos y líneas del dashboard: el texto alternativo de una foto pasa a ser por uso
-- (Ruling B-74). La misma foto de `media_assets` puede ir en varios productos, varias veces en uno
-- o en una línea, cada vez con su `alt`; `media_assets.alt` queda como el de la primera vez.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "image_alt" TEXT;

-- AlterTable. Escrito a mano: la columna nace nullable, se rellena y recién después pasa a NOT NULL
-- (Prisma la crea NOT NULL de una, y con filas no se puede).
ALTER TABLE "product_images" ADD COLUMN     "alt" TEXT;

-- Escrito a mano: relleno con el `alt` que tenía cada foto, así la tienda no cambia.
UPDATE "product_images" pi SET "alt" = ma."alt"
FROM "media_assets" ma
WHERE ma."id" = pi."media_asset_id";

UPDATE "categories" c SET "image_alt" = ma."alt"
FROM "media_assets" ma
WHERE ma."id" = c."image_id";

ALTER TABLE "product_images" ALTER COLUMN "alt" SET NOT NULL;
