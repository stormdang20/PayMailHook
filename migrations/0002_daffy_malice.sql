ALTER TABLE "email_configs" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_share_token_unique" UNIQUE("share_token");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_share_token_unique" UNIQUE("share_token");