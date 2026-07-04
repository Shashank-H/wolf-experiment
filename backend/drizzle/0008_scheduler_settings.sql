ALTER TABLE "user_settings" ADD COLUMN "trading_scheduler_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "morning_research_time_ist" varchar(5) DEFAULT '08:45' NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "eod_rca_time_ist" varchar(5) DEFAULT '15:35' NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "gtt_revalidation_scheduler_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "gtt_revalidation_interval_minutes" integer DEFAULT 60 NOT NULL;
