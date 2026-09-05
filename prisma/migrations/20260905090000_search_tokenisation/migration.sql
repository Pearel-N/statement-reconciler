-- Tokenise statement descriptions as plain words.
--
-- Postgres's text-search parser is built for prose and recognises structured
-- tokens: it reads "UPI/DR/741520749048/Lumen Broadband/NWBK" as file paths,
-- yielding tokens like "Broadband/NWBK" rather than the word "broadband".
-- Searching for a merchant name then matches nothing, which is exactly what a
-- user will type.
--
-- Statement descriptions are not prose. Flattening every non-alphanumeric
-- separator to a space before building the vector makes each word its own
-- token, which is the behaviour this data needs.

CREATE OR REPLACE FUNCTION transactions_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'simple',
    regexp_replace(coalesce(NEW.description, ''), '[^a-zA-Z0-9]+', ' ', 'g')
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Rebuild every existing vector under the new rule.
UPDATE "transactions" SET "description" = "description";
