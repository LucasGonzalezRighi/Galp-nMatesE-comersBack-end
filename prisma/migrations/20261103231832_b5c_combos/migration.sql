-- CreateEnum
CREATE TYPE "combo_status" AS ENUM ('draft', 'published');

-- AlterEnum
ALTER TYPE "line_type" ADD VALUE 'combo';

-- AlterTable
ALTER TABLE "order_item_components" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price_ars" INTEGER NOT NULL,
    "status" "combo_status" NOT NULL DEFAULT 'draft',
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "combo_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("combo_id","position")
);

-- CreateIndex
CREATE INDEX "combos_position_idx" ON "combos"("position");

-- CreateIndex
CREATE INDEX "combo_items_product_id_idx" ON "combo_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_combo_id_product_id_key" ON "combo_items"("combo_id", "product_id");

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Escrito a mano: ninguna sentencia de esta migración usa el valor 'combo' de "line_type"
-- (Postgres no deja usar un valor de enum en la misma transacción que lo agrega).

-- Escrito a mano (Prisma no expresa CHECK): el precio de un combo va de $1 a $99.999.999 (tope
-- del contrato).
ALTER TABLE "combos" ADD CONSTRAINT "combos_price_ars_check" CHECK ("price_ars" BETWEEN 1 AND 99999999);

-- Escrito a mano: las posiciones de los combos arrancan en 1 (sin único: renumerar va en una
-- transacción y un único no diferido chocaría).
ALTER TABLE "combos" ADD CONSTRAINT "combos_position_check" CHECK ("position" >= 1);

-- Escrito a mano: un combo lleva de 2 a 3 piezas, en las posiciones 1 a 3.
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_position_check" CHECK ("position" BETWEEN 1 AND 3);

-- Escrito a mano: las piezas de los kits ya guardados quedan en el orden de siempre (mate,
-- bombilla, yerba); las de un combo se guardan en el orden del combo.
UPDATE "order_item_components" SET "position" = CASE "role" WHEN 'mate' THEN 1 WHEN 'bombilla' THEN 2 ELSE 3 END;
