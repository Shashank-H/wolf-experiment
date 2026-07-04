ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_trade_candidate_id_trade_candidates_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "trade_candidate_id";--> statement-breakpoint
DROP TABLE IF EXISTS "trade_candidates";--> statement-breakpoint
