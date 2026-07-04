CREATE TABLE "broker_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker" varchar(64) DEFAULT 'kite' NOT NULL,
	"broker_user_id" varchar(128),
	"display_name" varchar(128),
	"status" varchar(64) DEFAULT 'configured' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker_account_id" uuid,
	"exchange" varchar(32) NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"average_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"last_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"pnl" numeric(18, 4) DEFAULT '0' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange" varchar(32) NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"last_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"change_percent" numeric(10, 4) DEFAULT '0' NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"event_type" varchar(128) NOT NULL,
	"broker_status" varchar(64),
	"message" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker_account_id" uuid,
	"broker_order_id" varchar(128),
	"exchange" varchar(32),
	"tradingsymbol" varchar(128),
	"transaction_type" varchar(16),
	"product" varchar(32),
	"order_type" varchar(32),
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"filled_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"average_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" varchar(64) DEFAULT 'created' NOT NULL,
	"status_message" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker_account_id" uuid,
	"exchange" varchar(32) NOT NULL,
	"tradingsymbol" varchar(128) NOT NULL,
	"product" varchar(32) DEFAULT 'CNC' NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"day_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"average_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"last_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"pnl" numeric(18, 4) DEFAULT '0' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings_snapshots" ADD CONSTRAINT "holdings_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings_snapshots" ADD CONSTRAINT "holdings_snapshots_broker_account_id_broker_accounts_id_fk" FOREIGN KEY ("broker_account_id") REFERENCES "public"."broker_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_broker_account_id_broker_accounts_id_fk" FOREIGN KEY ("broker_account_id") REFERENCES "public"."broker_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_broker_account_id_broker_accounts_id_fk" FOREIGN KEY ("broker_account_id") REFERENCES "public"."broker_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_accounts_user_broker_unique" ON "broker_accounts" USING btree ("user_id","broker");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_broker_order_unique" ON "orders" USING btree ("user_id","broker_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_user_symbol_product_unique" ON "positions" USING btree ("user_id","exchange","tradingsymbol","product");