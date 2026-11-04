-- CreateEnum
CREATE TYPE "contact_message_kind" AS ENUM ('contact', 'withdrawal');

-- CreateEnum
CREATE TYPE "contact_reason" AS ENUM ('Pedido', 'Envío', 'Cambio', 'Arrepentimiento', 'Otro');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "kind" "contact_message_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "order_number" TEXT,
    "reason" "contact_reason",
    "message" TEXT,
    "code" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_messages_code_key" ON "contact_messages"("code");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_id_idx" ON "contact_messages"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_kind_created_at_idx" ON "contact_messages"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at" DESC);

-- Escrito a mano (Prisma no expresa secuencias sueltas): numerador de los códigos de
-- arrepentimiento ARR-NNNNNN (Ruling B-76). Arranca en 1 y al pasar de 999999 nextval falla en
-- vez de dar la vuelta: un código nunca se repite. Un arrepentimiento descartado por el campo
-- trampa igual consume un número (como el mock).
CREATE SEQUENCE "withdrawal_code_seq" START WITH 1 MINVALUE 1 MAXVALUE 999999 NO CYCLE;

-- Escrito a mano (Prisma no expresa CHECK): un mensaje de contacto lleva motivo y texto y no tiene
-- código; un arrepentimiento lleva su código ARR- + 6 dígitos y no tiene motivo (el comentario
-- opcional va en "message").
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_kind_check" CHECK (
  ("kind" = 'contact' AND "reason" IS NOT NULL AND "message" IS NOT NULL AND "code" IS NULL)
  OR ("kind" = 'withdrawal' AND "reason" IS NULL AND "code" ~ '^ARR-[0-9]{6}$')
);

-- Escrito a mano (Prisma no expresa CHECK): el número de pedido, si está, es GLP- y cinco dígitos.
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_order_number_check" CHECK ("order_number" ~ '^GLP-[0-9]{5}$');

-- Escrito a mano (índice parcial): la bandeja filtra los no leídos y el resumen del dashboard los
-- cuenta (unreadMessages).
CREATE INDEX "contact_messages_unread_idx" ON "contact_messages"("created_at" DESC) WHERE "read_at" IS NULL;
