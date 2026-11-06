ALTER TABLE "Product" ADD COLUMN "specifications" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Bound direct SQL writes as well as application mutations. No invented specs
-- are backfilled into existing products: [] means not supplied by the seller.
CREATE FUNCTION valid_product_specifications(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(value) IS DISTINCT FROM 'array' THEN false
  ELSE jsonb_array_length(value) <= 30 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(value) AS entry
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR jsonb_typeof(entry->'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(entry->'value') IS DISTINCT FROM 'string'
      OR length(btrim(entry->>'label')) NOT BETWEEN 1 AND 60
      OR length(btrim(entry->>'value')) NOT BETWEEN 1 AND 300
      OR (entry->>'label') ~ '[[:cntrl:]]'
      OR (entry->>'value') ~ '[[:cntrl:]]'
      OR (entry - 'label' - 'value') <> '{}'::jsonb
  ) AND (SELECT count(*) = count(DISTINCT lower(btrim(entry->>'label'))) FROM jsonb_array_elements(value) AS entry)
  END
$$;
ALTER TABLE "Product" ADD CONSTRAINT "Product_specifications_valid" CHECK (valid_product_specifications("specifications"));
