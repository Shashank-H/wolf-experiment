CREATE TABLE "daily_research_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_date" varchar(16) NOT NULL,
	"status" varchar(64) DEFAULT 'completed' NOT NULL,
	"market_thesis" text DEFAULT '' NOT NULL,
	"sector_bias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(128),
	"raw_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtt_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"exchange" varchar(32) DEFAULT 'NSE' NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"transaction_type" varchar(16) DEFAULT 'BUY' NOT NULL,
	"trigger_price" numeric(18, 4),
	"limit_price" numeric(18, 4),
	"quantity" integer DEFAULT 1 NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"status" varchar(64) DEFAULT 'draft' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"provider" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"summary" text DEFAULT '' NOT NULL,
	"symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"exchange" varchar(32) DEFAULT 'NSE' NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"side" varchar(16) DEFAULT 'BUY' NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"entry_plan" text DEFAULT '' NOT NULL,
	"invalidation" text DEFAULT '' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"trade_date" varchar(16) NOT NULL,
	"exchange" varchar(32) DEFAULT 'NSE' NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"bias" varchar(16) DEFAULT 'neutral' NOT NULL,
	"source" varchar(64) DEFAULT 'ai' NOT NULL,
	"status" varchar(64) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD CONSTRAINT "daily_research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtt_candidates" ADD CONSTRAINT "gtt_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtt_candidates" ADD CONSTRAINT "gtt_candidates_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_candidates" ADD CONSTRAINT "trade_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_candidates" ADD CONSTRAINT "trade_candidates_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_research_sessions_user_trade_date_unique" ON "daily_research_sessions" USING btree ("user_id","trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_user_date_symbol_unique" ON "watchlist_items" USING btree ("user_id","trade_date","exchange","tradingsymbol");