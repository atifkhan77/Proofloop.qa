import { Redis } from 'ioredis';
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';

/**
 * Shared rate-limit counters in Redis (API-52 / PERF-04), so limits hold across several API
 * processes (cluster mode) and survive restarts.
 *
 * If Redis is unavailable, counting falls back to this process's memory instead of failing
 * open: auth limits stay in force during a Redis outage (per process, as before).
 */

// INCR + set the window on the first hit, atomically. Returns [hits, ms until reset].
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}
`;

let client: Redis | null = null;
function getClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6380', {
      // Fail fast (then fall back to memory) instead of queueing commands while Redis is down.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    let lastError = '';
    client.on('error', (err) => {
      if (err.message !== lastError) console.error(`[rate-limit] Redis error, using in-memory counters: ${err.message}`);
      lastError = err.message;
    });
    client.on('ready', () => {
      lastError = '';
    });
  }
  return client;
}

export class RedisFallbackStore implements Store {
  readonly prefix: string;
  readonly localKeys = false;
  private windowMs = 60_000;
  private readonly memory = new MemoryStore();

  constructor(name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  private get redis(): Redis | null {
    const c = getClient();
    return c.status === 'ready' ? c : null;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redis = this.redis;
    if (redis) {
      try {
        const [hits, ttl] = (await redis.eval(INCREMENT_SCRIPT, 1, this.prefix + key, String(this.windowMs))) as [number, number];
        return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
      } catch {
        // fall through to memory
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const redis = this.redis;
    if (redis) {
      try {
        await redis.decr(this.prefix + key);
        return;
      } catch {
        // fall through
      }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    await this.memory.resetKey(key);
    const redis = this.redis;
    if (redis) await redis.del(this.prefix + key).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    await this.memory.shutdown();
  }
}
