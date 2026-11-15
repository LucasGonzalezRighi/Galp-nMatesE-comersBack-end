-- Seguridad (auditoría, tanda B: pagos y pedidos).

-- NV-29: un evento cuyo despacho agota los reintentos de BullMQ vuelve a quedar pendiente para el
-- relay, con un contador (hasta 8 vueltas) y una espera creciente (`available_at`).
ALTER TABLE "outbox_events"
  ADD COLUMN "dispatch_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "available_at" TIMESTAMPTZ(3);

-- NV-28: la conciliación de pagos rota por la última vez que pasó por cada pedido, en lugar de
-- tomar siempre los mismos 50 más viejos.
ALTER TABLE "orders" ADD COLUMN "payment_reconciled_at" TIMESTAMPTZ(3);

-- NV-12: withdrawal_code_seq llegaba solo a 999999 y alguien anónimo podía agotarla (cada pedido de
-- arrepentimiento sin trampa toma un número) y dejar el formulario en 500 para siempre. El contrato
-- no fija el formato del código (texto de hasta 40), así que el máximo pasa a 12 dígitos: hasta
-- 999999 los códigos siguen siendo ARR-NNNNNN y después crecen (ARR-1000000…). Un número nunca se
-- repite (NO CYCLE). Desde 3983e8d el campo trampa ya no consume números (el comentario de la
-- migración b6_support que dice lo contrario quedó viejo).
ALTER SEQUENCE "withdrawal_code_seq" MAXVALUE 999999999999;

ALTER TABLE "contact_messages" DROP CONSTRAINT "contact_messages_kind_check";
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_kind_check" CHECK (
  ("kind" = 'contact' AND "reason" IS NOT NULL AND "message" IS NOT NULL AND "code" IS NULL)
  OR ("kind" = 'withdrawal' AND "reason" IS NULL AND "code" ~ '^ARR-[0-9]{6,12}$')
);
