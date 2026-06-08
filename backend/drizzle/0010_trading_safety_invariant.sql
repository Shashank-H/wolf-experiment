ALTER TABLE "gtt_candidates" ADD COLUMN "target_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "gtt_candidates" ADD COLUMN "stop_loss_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "gtt_orders" ADD COLUMN "target_price" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gtt_orders" ADD COLUMN "stop_loss_price" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "requested_action" SET DEFAULT 'internal_action';
