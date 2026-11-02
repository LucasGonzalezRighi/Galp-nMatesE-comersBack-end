-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('none', 'pending', 'action_required', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded', 'in_dispute', 'charged_back');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('mp_redirect', 'card');

-- CreateEnum
CREATE TYPE "line_type" AS ENUM ('product', 'kit');

-- CreateEnum
CREATE TYPE "order_actor" AS ENUM ('system', 'admin', 'customer', 'provider');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('active', 'committed', 'released');

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID,
    "status" "order_status" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "payment_status" NOT NULL DEFAULT 'none',
    "payment_method" "payment_method" NOT NULL,
    "contact_email" CITEXT NOT NULL,
    "contact_first_name" TEXT NOT NULL,
    "contact_last_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "shipping_method" "shipping_method" NOT NULL,
    "shipping_address" JSONB,
    "shipping_cost_ars" INTEGER NOT NULL,
    "shipping_eta" TEXT NOT NULL,
    "items_gross_ars" INTEGER NOT NULL,
    "kit_savings_ars" INTEGER NOT NULL,
    "subtotal_ars" INTEGER NOT NULL,
    "total_ars" INTEGER NOT NULL,
    "kit_discount_percent" INTEGER NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "reserved_until" TIMESTAMPTZ(3) NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_type" "line_type" NOT NULL,
    "product_id" UUID,
    "product_slug" TEXT,
    "name" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_ars" INTEGER NOT NULL,
    "kit_savings_ars" INTEGER NOT NULL,
    "total_ars" INTEGER NOT NULL,
    "options" JSONB,
    "position" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_components" (
    "order_item_id" UUID NOT NULL,
    "role" "product_group" NOT NULL,
    "product_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price_ars" INTEGER NOT NULL,

    CONSTRAINT "order_item_components_pkey" PRIMARY KEY ("order_item_id","role")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor" "order_actor" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "order_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_product_id_idx" ON "stock_reservations"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_order_id_product_id_key" ON "stock_reservations"("order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders"("access_token_hash");

-- CreateIndex
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_reserved_until_idx" ON "orders"("status", "reserved_until");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_position_key" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_item_components_product_id_idx" ON "order_item_components"("product_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_components" ADD CONSTRAINT "order_item_components_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_components" ADD CONSTRAINT "order_item_components_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Escrito a mano (Prisma no expresa secuencias sueltas): numerador de los pedidos GLP-NNNNN
-- (Ruling B-16). Arranca en 10001 (GLP-09001…09012 quedan para la demo del admin) y al pasar
-- de 99999 nextval falla en vez de dar la vuelta: un número nunca se repite.
CREATE SEQUENCE "order_number_seq" START WITH 10001 MINVALUE 10001 MAXVALUE 99999 NO CYCLE;

-- Escrito a mano (Prisma no expresa CHECK): una línea lleva de 1 a 20 unidades (tope del contrato).
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20);

-- Escrito a mano: una reserva aparta al menos una unidad.
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" >= 1);

-- Escrito a mano: los totales del pedido cierran (subtotal = bruto − ahorro de kits; total =
-- subtotal + envío).
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_check" CHECK ("subtotal_ars" = "items_gross_ars" - "kit_savings_ars" AND "total_ars" = "subtotal_ars" + "shipping_cost_ars");
