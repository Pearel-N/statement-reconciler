-- Full-text search over transaction descriptions.
--
-- The 'simple' text search configuration is used rather than 'english', on
-- purpose. Statement descriptions are not prose: they are merchant names,
-- payment rails and reference codes. English stemming would fold distinct
-- tokens together, and English stop-word removal would silently drop terms
-- that carry meaning here. 'simple' lower-cases and tokenises and does
-- nothing else, which is what this data wants.

CREATE OR REPLACE FUNCTION transactions_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', coalesce(NEW.description, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Maintained by the database rather than the application: extraction,
-- corrections and any future backfill all write descriptions, and each one
-- would otherwise have to remember to update the vector.
DROP TRIGGER IF EXISTS transactions_search_vector_trigger ON "transactions";

CREATE TRIGGER transactions_search_vector_trigger
BEFORE INSERT OR UPDATE OF "description" ON "transactions"
FOR EACH ROW EXECUTE FUNCTION transactions_search_vector_update();

-- Backfill anything extracted before the trigger existed.
UPDATE "transactions" SET "description" = "description";

CREATE INDEX IF NOT EXISTS "transactions_search_vector_idx"
  ON "transactions" USING GIN ("search_vector");

-- Workspace-wide queries filter statements first, then sort transactions by
-- date; these support that path rather than the per-statement one already
-- indexed.
CREATE INDEX IF NOT EXISTS "transactions_date_idx" ON "transactions"("date");
