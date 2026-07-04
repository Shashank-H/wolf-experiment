DROP INDEX IF EXISTS "daily_research_sessions_user_trade_date_dry_unique";

CREATE TABLE IF NOT EXISTS "research_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "status" varchar(64) DEFAULT 'queued' NOT NULL,
  "research_type" varchar(64) DEFAULT 'pre_market' NOT NULL,
  "client_local_date" varchar(16),
  "client_time_zone" varchar(96),
  "exa_run_id" text,
  "model" varchar(128),
  "market_thesis" text DEFAULT '' NOT NULL,
  "sector_bias" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "risk_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "raw_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cost_dollars" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_run_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" varchar(128) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_run_events" ADD CONSTRAINT "research_run_events_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_run_events" ADD CONSTRAINT "research_run_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
