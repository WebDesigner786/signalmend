ALTER TABLE "workspaces"
    ADD COLUMN "tenant_id" UUID;

ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" NO FORCE ROW LEVEL SECURITY;

WITH workspace_tenants AS MATERIALIZED (
    SELECT
        "id" AS "workspace_id",
        gen_random_uuid() AS "tenant_id",
        "name",
        "owner_id",
        CASE
            WHEN "subscription_tier" = 'free' THEN 'free'::"tenant_tier"
            ELSE 'premium'::"tenant_tier"
        END AS "tier"
    FROM "workspaces"
),
inserted_tenants AS (
    INSERT INTO "tenants" ("id", "name", "business_niche", "tier")
    SELECT "tenant_id", "name", 'Other', "tier"
    FROM workspace_tenants
    RETURNING "id"
)
UPDATE "workspaces" AS workspace
SET "tenant_id" = workspace_tenants."tenant_id"
FROM workspace_tenants
JOIN inserted_tenants ON inserted_tenants."id" = workspace_tenants."tenant_id"
WHERE workspace."id" = workspace_tenants."workspace_id";

INSERT INTO "tenant_members" ("id", "tenant_id", "user_id", "role")
SELECT gen_random_uuid(), workspace."tenant_id", workspace."owner_id", 'owner'
FROM "workspaces" AS workspace
WHERE workspace."tenant_id" IS NOT NULL
ON CONFLICT ("tenant_id", "user_id") DO NOTHING;

INSERT INTO "tenant_members" ("id", "tenant_id", "user_id", "role")
SELECT
    gen_random_uuid(),
    workspace."tenant_id",
    member."user_id",
    CASE member."role"::text
        WHEN 'owner' THEN 'owner'::"tenant_member_role"
        WHEN 'admin' THEN 'admin'::"tenant_member_role"
        ELSE 'member'::"tenant_member_role"
    END
FROM "workspace_members" AS member
JOIN "workspaces" AS workspace ON workspace."id" = member."workspace_id"
WHERE workspace."tenant_id" IS NOT NULL
ON CONFLICT ("tenant_id", "user_id") DO NOTHING;

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "workspaces_tenant_id_key"
    ON "workspaces"("tenant_id");

ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
