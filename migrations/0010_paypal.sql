ALTER TYPE "public"."bank" ADD VALUE 'PAYPAL';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" text DEFAULT 'VND' NOT NULL;