import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 64 }).notNull(),
  label: varchar('label', { length: 128 }).notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('api_keys_user_provider_label_unique').on(table.userId, table.provider, table.label),
]);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  yoloModeEnabled: boolean('yolo_mode_enabled').notNull().default(false),
  triggerResearchPolicy: varchar('trigger_research_policy', { length: 64 }).notNull().default('only_high_risk'),
  providerConfig: jsonb('provider_config').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tradingPreferences = pgTable('trading_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  maxDailyLoss: integer('max_daily_loss').notNull().default(0),
  maxTradesPerDay: integer('max_trades_per_day').notNull().default(0),
  maxCapitalPerTrade: integer('max_capital_per_trade').notNull().default(0),
  maxOpenPositions: integer('max_open_positions').notNull().default(0),
  symbolBlacklist: jsonb('symbol_blacklist').$type<string[]>().notNull().default([]),
  strategyBlacklist: jsonb('strategy_blacklist').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 128 }).notNull(),
  entityType: varchar('entity_type', { length: 128 }),
  entityId: text('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const brokerAccounts = pgTable('broker_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  broker: varchar('broker', { length: 64 }).notNull().default('kite'),
  brokerUserId: varchar('broker_user_id', { length: 128 }),
  displayName: varchar('display_name', { length: 128 }),
  status: varchar('status', { length: 64 }).notNull().default('configured'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('broker_accounts_user_broker_unique').on(table.userId, table.broker),
]);

export const holdingsSnapshots = pgTable('holdings_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brokerAccountId: uuid('broker_account_id').references(() => brokerAccounts.id, { onDelete: 'set null' }),
  exchange: varchar('exchange', { length: 32 }).notNull(),
  tradingsymbol: varchar('tradingsymbol', { length: 128 }).notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  averagePrice: numeric('average_price', { precision: 18, scale: 4 }).notNull().default('0'),
  lastPrice: numeric('last_price', { precision: 18, scale: 4 }).notNull().default('0'),
  pnl: numeric('pnl', { precision: 18, scale: 4 }).notNull().default('0'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brokerAccountId: uuid('broker_account_id').references(() => brokerAccounts.id, { onDelete: 'set null' }),
  exchange: varchar('exchange', { length: 32 }).notNull(),
  tradingsymbol: varchar('tradingsymbol', { length: 128 }).notNull(),
  product: varchar('product', { length: 32 }).notNull().default('CNC'),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  dayQuantity: numeric('day_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  averagePrice: numeric('average_price', { precision: 18, scale: 4 }).notNull().default('0'),
  lastPrice: numeric('last_price', { precision: 18, scale: 4 }).notNull().default('0'),
  pnl: numeric('pnl', { precision: 18, scale: 4 }).notNull().default('0'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('positions_user_symbol_product_unique').on(table.userId, table.exchange, table.tradingsymbol, table.product),
]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brokerAccountId: uuid('broker_account_id').references(() => brokerAccounts.id, { onDelete: 'set null' }),
  brokerOrderId: varchar('broker_order_id', { length: 128 }),
  exchange: varchar('exchange', { length: 32 }),
  tradingsymbol: varchar('tradingsymbol', { length: 128 }),
  transactionType: varchar('transaction_type', { length: 16 }),
  product: varchar('product', { length: 32 }),
  orderType: varchar('order_type', { length: 32 }),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  filledQuantity: numeric('filled_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  averagePrice: numeric('average_price', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 64 }).notNull().default('created'),
  statusMessage: text('status_message'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('orders_user_broker_order_unique').on(table.userId, table.brokerOrderId),
]);

export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  brokerStatus: varchar('broker_status', { length: 64 }),
  message: text('message'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const marketSnapshots = pgTable('market_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  exchange: varchar('exchange', { length: 32 }).notNull(),
  tradingsymbol: varchar('tradingsymbol', { length: 128 }).notNull(),
  lastPrice: numeric('last_price', { precision: 18, scale: 4 }).notNull().default('0'),
  changePercent: numeric('change_percent', { precision: 10, scale: 4 }).notNull().default('0'),
  volume: integer('volume').notNull().default(0),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
