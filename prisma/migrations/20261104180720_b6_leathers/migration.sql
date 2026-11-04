-- AlterTable
ALTER TABLE "products" ADD COLUMN     "leathers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Escrito a mano (Prisma no expresa CHECK): los cueros de un producto son de `Leather` y la
-- lista nunca es null (Prisma la deja sin NOT NULL; un null escrito a mano no pasa). Los repetidos,
-- el orden y la regla "solo los mates llevan cuero" los cuida la app (Ruling B-70).
ALTER TABLE "products" ADD CONSTRAINT "products_leathers_check" CHECK ("leathers" IS NOT NULL AND "leathers" <@ ARRAY['Negro', 'Marrón', 'Crudo', 'Borravino']::TEXT[]);

-- Escrito a mano: relleno para no cambiar la tienda. Hasta B6 todo mate ofrecía los cuatro cueros
-- (fijos por grupo); desde acá los guarda cada producto y el resto queda con la lista vacía.
UPDATE "products" p SET "leathers" = ARRAY['Negro', 'Marrón', 'Crudo', 'Borravino']::TEXT[]
FROM "categories" c
WHERE c."id" = p."category_id" AND c."group" = 'mate';
