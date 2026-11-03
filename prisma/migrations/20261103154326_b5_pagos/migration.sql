-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('mercadopago');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('pending', 'approved', 'failed');

-- CreateEnum
CREATE TYPE "refund_reason" AS ENUM ('duplicate_payment', 'late_approval', 'manual');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'mercadopago',
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'none',
    "provider_status" TEXT,
    "status_detail" TEXT,
    "provider_payment_id" TEXT,
    "provider_preference_id" TEXT,
    "init_point" TEXT,
    "challenge_url" TEXT,
    "amount_ars" INTEGER NOT NULL,
    "refunded_ars" INTEGER NOT NULL DEFAULT 0,
    "installments" INTEGER,
    "payment_type_id" TEXT,
    "card_brand" TEXT,
    "card_last_four" TEXT,
    "issuer_id" TEXT,
    "payer_email" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider_refund_id" TEXT,
    "amount_ars" INTEGER NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'pending',
    "reason" "refund_reason" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "action" TEXT,
    "resource_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_preference_id_idx" ON "payments"("provider_preference_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Escrito a mano: un solo intento de pago activo por pedido (índice único parcial que Prisma no
-- expresa). Activo = `none`, `pending` o `action_required`; al crear otro, el anterior pasa a
-- inactivo en la misma transacción (Ruling B-44).
CREATE UNIQUE INDEX "payments_active_per_order_idx" ON "payments"("order_id") WHERE "is_active";
