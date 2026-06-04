import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

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

export type User = typeof users.$inferSelect;
