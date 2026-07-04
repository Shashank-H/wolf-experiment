import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env';
import { pollMarket, syncOrders, syncPortfolio } from '../services/broker-sync';
import { queueNames } from './queue-names';

function redisConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    maxRetriesPerRequest: null,
  };
}

const connection = redisConnection();

export const syncOrdersQueue = new Queue(queueNames.syncOrders, { connection });
export const syncPositionsQueue = new Queue(queueNames.syncPositions, { connection });
export const marketPollQueue = new Queue(queueNames.marketPoll, { connection });

export function startQueueProcessors() {
  const workers = [
    new Worker(queueNames.syncOrders, async (job) => syncOrders(String(job.data.userId)), { connection: redisConnection() }),
    new Worker(queueNames.syncPositions, async (job) => syncPortfolio(String(job.data.userId)), { connection: redisConnection() }),
    new Worker(queueNames.marketPoll, async (job) => pollMarket(String(job.data.userId), job.data.symbols ?? []), { connection: redisConnection() }),
  ];
  return workers;
}
