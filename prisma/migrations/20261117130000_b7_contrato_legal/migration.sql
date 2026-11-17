-- B7 (LS-3): enlaces a Defensa del Consumidor en los ajustes. Una base ya sembrada recibe los de
-- fábrica (`DEFAULT_CONSUMER_LINKS` del front); lo que el admin guarde después no se pisa.
ALTER TABLE "settings" ADD COLUMN "consumer_links" JSONB NOT NULL DEFAULT '{"cabaUrl":"https://buenosaires.gob.ar/gobierno/atencion-ciudadana/defensa-al-consumidor","nationalUrl":"https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario"}';

-- El pie ya no tiene `consumerDefenseUrl` (los enlaces viven en los ajustes): se saca del JSON
-- guardado, así la respuesta de `GET /content/footer` queda igual al contrato.
UPDATE "content_blocks" SET "data" = "data" - 'consumerDefenseUrl' WHERE "key" = 'footer';
