ALTER TABLE "user_settings" ADD COLUMN "dry_run_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "daily_research_sessions_user_trade_date_unique";--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD COLUMN "is_dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD COLUMN "dry_run_status" varchar(64);--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD COLUMN "dry_run_total_pnl" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD COLUMN "dry_run_summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_research_sessions" ADD COLUMN "dry_run_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "research_session_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gtt_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "trade_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "current_price" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "exit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pnl" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE TABLE "rca_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"research_session_id" uuid,
	"trade_date" varchar(16) NOT NULL,
	"report_type" varchar(64) DEFAULT 'dry_run_eod' NOT NULL,
	"daily_summary" text DEFAULT '' NOT NULL,
	"strategy_review" text DEFAULT '' NOT NULL,
	"agent_reasoning_review" text DEFAULT '' NOT NULL,
	"risk_review" text DEFAULT '' NOT NULL,
	"recommended_improvements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_improvement_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_pnl" numeric(18, 4) DEFAULT '0' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "rca_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rca_report_id" uuid NOT NULL,
	"order_id" uuid,
	"symbol" varchar(128) DEFAULT '' NOT NULL,
	"category" varchar(96) DEFAULT 'thesis_review' NOT NULL,
	"outcome" varchar(64) DEFAULT 'flat' NOT NULL,
	"pnl" numeric(18, 4) DEFAULT '0' NOT NULL,
	"finding" text DEFAULT '' NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_research_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gtt_candidate_id_gtt_candidates_id_fk" FOREIGN KEY ("gtt_candidate_id") REFERENCES "public"."gtt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_trade_candidate_id_trade_candidates_id_fk" FOREIGN KEY ("trade_candidate_id") REFERENCES "public"."trade_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_reports" ADD CONSTRAINT "rca_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_reports" ADD CONSTRAINT "rca_reports_research_session_id_daily_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."daily_research_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_findings" ADD CONSTRAINT "rca_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_findings" ADD CONSTRAINT "rca_findings_rca_report_id_rca_reports_id_fk" FOREIGN KEY ("rca_report_id") REFERENCES "public"."rca_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_findings" ADD CONSTRAINT "rca_findings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_research_sessions_user_trade_date_dry_unique" ON "daily_research_sessions" USING btree ("user_id","trade_date","is_dry_run");
