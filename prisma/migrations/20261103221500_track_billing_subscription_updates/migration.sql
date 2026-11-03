ALTER TABLE "workspaces"
    ADD COLUMN "lemon_squeezy_subscription_id" VARCHAR(128),
    ADD COLUMN "lemon_squeezy_subscription_updated_at" TIMESTAMPTZ(6);
