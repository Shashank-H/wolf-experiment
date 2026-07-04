CREATE TABLE "gtt_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker_account_id" uuid,
	"gtt_candidate_id" uuid,
	"broker_gtt_id" varchar(128),
	"idempotency_key" varchar(192) NOT NULL,
	"exchange" varchar(32) DEFAULT 'NSE' NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"transaction_type" varchar(16) DEFAULT 'BUY' NOT NULL,
	"trigger_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"limit_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" varchar(64) DEFAULT 'created' NOT NULL,
	"status_message" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" varchar(192);--> statement-breakpoint
ALTER TABLE "gtt_orders" ADD CONSTRAINT "gtt_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtt_orders" ADD CONSTRAINT "gtt_orders_broker_account_id_broker_accounts_id_fk" FOREIGN KEY ("broker_account_id") REFERENCES "public"."broker_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtt_orders" ADD CONSTRAINT "gtt_orders_gtt_candidate_id_gtt_candidates_id_fk" FOREIGN KEY ("gtt_candidate_id") REFERENCES "public"."gtt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gtt_orders_user_broker_gtt_unique" ON "gtt_orders" USING btree ("user_id","broker_gtt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gtt_orders_user_idempotency_key_unique" ON "gtt_orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_key_unique" ON "orders" USING btree ("user_id","idempotency_key");