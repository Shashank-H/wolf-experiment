import { Redis } from 'ioredis';
import { env } from '../config/env';
import type { Quote } from '../providers/broker/types';

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export function quoteCacheKey(userId: string, exchange: string, tradingsymbol: string) {
  return `quote:${userId}:${exchange}:${tradingsymbol}`;
}

export async function cacheQuotes(userId: string, quotes: Quote[]) {
  if (quotes.length === 0) return;
  const pipeline = redis.pipeline();
  for (const quote of quotes) {
    pipeline.set(quoteCacheKey(userId, quote.exchange, quote.tradingsymbol), JSON.stringify(quote), 'EX', 60 * 60 * 6);
  }
  await pipeline.exec();
}

export async function getCachedQuote(userId: string, exchange: string, tradingsymbol: string): Promise<Quote | null> {
  const raw = await redis.get(quoteCacheKey(userId, exchange, tradingsymbol));
  return raw ? (JSON.parse(raw) as Quote) : null;
}
