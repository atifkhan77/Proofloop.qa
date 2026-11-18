import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Queue consumed by apps/worker. Keep the name in sync with apps/worker/src/index.ts. */
export const EXECUTION_QUEUE = 'automation-executions';

export interface ExecutionJobData {
  executionId: string;
  automationProjectId: string;
  repository: string | null;
  branch: string | null;
  framework: string;
}

// .env is loaded by ../config (imported first in index.ts). 6380 = this repo's Redis
// (docker-compose maps 6380->6379; host 6379 belongs to another project).
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';

// Producer connection: enableOfflineQueue=false makes queue.add() fail fast when Redis is
// down, instead of buffering the command and hanging the HTTP request indefinitely.
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });

export const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE, {
  connection,
  defaultJobOptions: {
    // Run history lives in Postgres; don't let finished jobs pile up in Redis forever.
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

// Log Redis connection errors once per distinct message (reconnect attempts repeat them).
// Note: removing this listener did NOT crash the API in a Redis-outage test (2026-11-10).
let lastError = '';
executionQueue.on('error', (err) => {
  if (err.message !== lastError) console.error(`[queue] Redis error: ${err.message}`);
  lastError = err.message;
});
connection.on('ready', () => {
  lastError = '';
});
