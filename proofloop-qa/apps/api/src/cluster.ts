import cluster from 'node:cluster';
import os from 'node:os';

/**
 * Production entry (PERF-04): runs WEB_CONCURRENCY API processes behind one port.
 *
 * - Default 1: behaves exactly like `node dist/index.js`.
 * - Shared state is already external: Postgres, BullMQ/Redis, and the rate-limit counters
 *   (Redis, lib/rate-limit-store.ts), so requests can land on any process.
 * - Each process has its own Prisma pool (default num_cpus*2+1 connections): keep
 *   WEB_CONCURRENCY x pool size below Postgres max_connections (100 by default), or set
 *   `connection_limit` in DATABASE_URL.
 * - A crashed process is replaced; a crash loop (5 exits within 60 s) stops respawning.
 */
const requested = Number(process.env.WEB_CONCURRENCY);
const workers = Number.isInteger(requested) && requested > 0 ? Math.min(requested, os.availableParallelism()) : 1;

if (workers > 1 && cluster.isPrimary) {
  console.log(`PROOFLOOP API cluster: starting ${workers} processes`);
  for (let i = 0; i < workers; i++) cluster.fork();

  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.kill();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const recentExits: number[] = [];
  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    const now = Date.now();
    recentExits.push(now);
    while (recentExits.length && now - recentExits[0] > 60_000) recentExits.shift();
    console.error(`[cluster] process ${worker.process.pid} exited (${signal ?? code})`);
    if (recentExits.length >= 5) {
      console.error('[cluster] crash loop detected, not respawning');
      return;
    }
    cluster.fork();
  });
} else {
  require('./index');
}
