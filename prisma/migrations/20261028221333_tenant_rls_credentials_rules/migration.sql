CREATE TYPE "tenant_tier" AS ENUM ('free', 'premium');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "business_niche" VARCHAR(120) NOT NULL,
    "tier" "tenant_tier" NOT NULL DEFAULT 'free',
    "active_token_allowances" INTEGER NOT NULL DEFAULT 1000,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_encryption_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key_reference" VARCHAR(512) NOT NULL,
    "key_version" INTEGER NOT NULL,
    "encrypted_data_key" TEXT NOT NULL,
    "wrapping_iv" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_encryption_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "encrypted_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tenant_encryption_key_id" UUID NOT NULL,
    "service_name" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "encryption_iv" VARCHAR(64) NOT NULL,
    "authentication_tag" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "encrypted_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automated_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automated_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_encryption_keys_tenant_id_id_key"
    ON "tenant_encryption_keys"("tenant_id", "id");
CREATE UNIQUE INDEX "tenant_encryption_keys_tenant_id_key_reference_key"
    ON "tenant_encryption_keys"("tenant_id", "key_reference");
CREATE UNIQUE INDEX "tenant_encryption_keys_tenant_id_key_version_key"
    ON "tenant_encryption_keys"("tenant_id", "key_version");
CREATE INDEX "tenant_encryption_keys_tenant_id_is_active_idx"
    ON "tenant_encryption_keys"("tenant_id", "is_active");

CREATE UNIQUE INDEX "encrypted_credentials_tenant_id_service_name_name_key"
    ON "encrypted_credentials"("tenant_id", "service_name", "name");
CREATE UNIQUE INDEX "encrypted_credentials_tenant_encryption_key_iv_key"
    ON "encrypted_credentials"("tenant_encryption_key_id", "encryption_iv");
CREATE INDEX "encrypted_credentials_tenant_id_service_name_idx"
    ON "encrypted_credentials"("tenant_id", "service_name");

CREATE INDEX "tenants_tier_idx" ON "tenants"("tier");
CREATE INDEX "automated_rules_tenant_id_is_enabled_priority_idx"
    ON "automated_rules"("tenant_id", "is_enabled", "priority");

ALTER TABLE "tenant_encryption_keys"
    ADD CONSTRAINT "tenant_encryption_keys_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "encrypted_credentials"
    ADD CONSTRAINT "encrypted_credentials_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "encrypted_credentials"
    ADD CONSTRAINT "encrypted_credentials_tenant_id_tenant_encryption_key_id_fkey"
    FOREIGN KEY ("tenant_id", "tenant_encryption_key_id")
    REFERENCES "tenant_encryption_keys"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automated_rules"
    ADD CONSTRAINT "automated_rules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_encryption_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_encryption_keys" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encrypted_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encrypted_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "automated_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automated_rules" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenants_select_own_tenant"
    ON "tenants" FOR SELECT
    USING ("id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenants_insert_own_tenant"
    ON "tenants" FOR INSERT
    WITH CHECK ("id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenants_update_own_tenant"
    ON "tenants" FOR UPDATE
    USING ("id"::text = current_setting('app.tenant_id', true))
    WITH CHECK ("id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenants_delete_own_tenant"
    ON "tenants" FOR DELETE
    USING ("id"::text = current_setting('app.tenant_id', true));

CREATE POLICY "tenant_encryption_keys_select_own_tenant"
    ON "tenant_encryption_keys" FOR SELECT
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_encryption_keys_insert_own_tenant"
    ON "tenant_encryption_keys" FOR INSERT
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_encryption_keys_update_own_tenant"
    ON "tenant_encryption_keys" FOR UPDATE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "tenant_encryption_keys_delete_own_tenant"
    ON "tenant_encryption_keys" FOR DELETE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));

CREATE POLICY "encrypted_credentials_select_own_tenant"
    ON "encrypted_credentials" FOR SELECT
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "encrypted_credentials_insert_own_tenant"
    ON "encrypted_credentials" FOR INSERT
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "encrypted_credentials_update_own_tenant"
    ON "encrypted_credentials" FOR UPDATE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "encrypted_credentials_delete_own_tenant"
    ON "encrypted_credentials" FOR DELETE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));

CREATE POLICY "automated_rules_select_own_tenant"
    ON "automated_rules" FOR SELECT
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "automated_rules_insert_own_tenant"
    ON "automated_rules" FOR INSERT
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "automated_rules_update_own_tenant"
    ON "automated_rules" FOR UPDATE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
CREATE POLICY "automated_rules_delete_own_tenant"
    ON "automated_rules" FOR DELETE
    USING ("tenant_id"::text = current_setting('app.tenant_id', true));
