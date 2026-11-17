-- B7 (LS-5): columnas sin uso con datos personales.
ALTER TABLE "customers" DROP COLUMN "document_type",
DROP COLUMN "document_number";
