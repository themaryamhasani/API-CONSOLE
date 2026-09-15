-- AlterTable
ALTER TABLE "identity"."directory_users" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "identity"."directory_users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "identity"."directory_users" ADD COLUMN IF NOT EXISTS "password_updated_at" TIMESTAMPTZ;
ALTER TABLE "identity"."directory_users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "directory_users_username_key" ON "identity"."directory_users"("username");
CREATE INDEX IF NOT EXISTS "directory_users_username_idx" ON "identity"."directory_users"("username");
