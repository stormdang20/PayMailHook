ALTER TYPE "public"."ingest_source" ADD VALUE 'gmail_oauth';--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "google_account_id" text;--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "gmail_history_id" text;--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "gmail_watch_expires_at" timestamp with time zone;