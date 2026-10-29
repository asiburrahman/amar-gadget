ALTER TABLE "Address" ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Address" ADD CONSTRAINT "Address_version_positive" CHECK (version > 0);
