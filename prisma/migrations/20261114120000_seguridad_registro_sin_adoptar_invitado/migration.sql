-- Seguridad (auditoría, NV-02): el registro ya no adopta al invitado que compró con el mismo email.
-- Escribir un email no prueba que sea de quien se registra, así que la cuenta nueva tiene su propio
-- cliente y el invitado (con sus pedidos y sus datos) queda como estaba. Un email puede tener a la
-- vez su invitado y el cliente de su cuenta; sigue habiendo un solo invitado por email (índice único
-- parcial) y una sola cuenta (lo garantiza `users.email`).

-- DropIndex
DROP INDEX "customers_email_key";

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- Un solo invitado por email (Prisma no modela índices parciales: queda acá, como el de la libreta).
CREATE UNIQUE INDEX "customers_guest_email_key" ON "customers"("email") WHERE "user_id" IS NULL;
