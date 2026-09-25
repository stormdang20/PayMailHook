ALTER TYPE "public"."ingest_source" ADD VALUE 'forwarding';--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "forwarding_address" text;--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "forwarding_confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_forwarding_address_unique" UNIQUE("forwarding_address");