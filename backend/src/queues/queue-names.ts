export const queueNames = {
  syncOrders: 'sync_orders',
  syncPositions: 'sync_positions',
  marketPoll: 'market_poll',
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];
