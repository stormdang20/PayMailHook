ALTER TABLE "email_configs" DROP CONSTRAINT "email_configs_ingest_token_hash_unique";--> statement-breakpoint
ALTER TABLE "email_configs" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."ingest_source";--> statement-breakpoint
CREATE TYPE "public"."ingest_source" AS ENUM('imap', 'gmail_oauth', 'forwarding');--> statement-breakpoint
ALTER TABLE "email_configs" ALTER COLUMN "source" SET DATA TYPE "public"."ingest_source" USING "source"::"public"."ingest_source";--> statement-breakpoint
ALTER TABLE "email_configs" DROP COLUMN "ingest_token_hash";