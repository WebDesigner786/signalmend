CREATE TYPE "tenant_member_role" AS ENUM ('owner', 'admin', 'member');

CREATE TABLE "tenant_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenant_member_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_members_tenant_id_user_id_key"
    ON "tenant_members"("tenant_id", "user_id");
CREATE INDEX "tenant_members_user_id_idx"
    ON "tenant_members"("user_id");

ALTER TABLE "tenant_members"
    ADD CONSTRAINT "tenant_members_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_members"
    ADD CONSTRAINT "tenant_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_select_own_tenant"
    ON "tenant_members" FOR SELECT
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_members_insert_own_tenant"
    ON "tenant_members" FOR INSERT
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_members_update_own_tenant"
    ON "tenant_members" FOR UPDATE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_members_delete_own_tenant"
    ON "tenant_members" FOR DELETE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "encrypted_credentials"
    ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
