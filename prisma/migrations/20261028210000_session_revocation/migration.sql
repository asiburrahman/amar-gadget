BEGIN;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_sessionVersion_check" CHECK ("sessionVersion" >= 0);

-- Cover every credential writer, including operator SQL and future routes.
-- Ordinary profile edits do not revoke sessions. A hash replacement does.
CREATE FUNCTION bump_user_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW."isVerified" IS DISTINCT FROM OLD."isVerified"
    OR NEW."sellerStatus" IS DISTINCT FROM OLD."sellerStatus" THEN
    NEW."sessionVersion" := OLD."sessionVersion" + 1;
  ELSIF NEW."sessionVersion" < OLD."sessionVersion" THEN
    RAISE EXCEPTION 'Session version cannot decrease' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_session_version BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION bump_user_session_version();
COMMIT;
