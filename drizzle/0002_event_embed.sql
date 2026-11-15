ALTER TABLE "events" ADD COLUMN "embed_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;