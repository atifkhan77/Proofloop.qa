import os from 'node:os';
import { Worker } from 'node:worker_threads';

/**
 * bcrypt off the main thread (performance review 2026-11-12).
 *
 * bcryptjs is pure JavaScript: one cost-12 hash/compare is ~300 ms of CPU on the event loop.
 * Measured before this change: with 5 concurrent logins, GET /api/projects went from p50 6 ms to
 * p50 1177 ms for every other user. This pool runs the same bcryptjs code in worker threads, so
 * the API keeps serving requests while passwords are checked. Hashes are unchanged ($2b$ format).
 *
 * Eval-mode workers (inline code) so this works the same under ts-node-dev and from dist/.
 */

const BCRYPT_PATH = require.resolve('bcryptjs');
const WORKER_CODE = `
const { parentPort } = require('node:worker_threads');
const bcrypt = require(${JSON.stringify(BCRYPT_PATH)});
parentPort.on('message', ({ id, op, a, b }) => {
  try {
    const result = op === 'hash' ? bcrypt.hashSync(a, b) : bcrypt.compareSync(a, b);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});
`;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; pending: Map<number, Pending> };

// Shared across all API processes in cluster mode (cluster.ts): split the spare cores.
const processes = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);
const POOL_SIZE = Math.max(1, Math.min(4, Math.floor((os.availableParallelism() - 1) / processes)));
const slots: Slot[] = [];
let nextId = 0;
let nextSlot = 0;

function spawn(index: number): Slot {
  const slot: Slot = { worker: new Worker(WORKER_CODE, { eval: true }), pending: new Map() };
  slot.worker.unref(); // never keeps the process alive on its own
  slot.worker.on('message', ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
    const p = slot.pending.get(id);
    if (!p) return;
    slot.pending.delete(id);
    if (error !== undefined) p.reject(new Error(error));
    else p.resolve(result);
  });
  const fail = (err: Error) => {
    for (const p of slot.pending.values()) p.reject(err);
    slot.pending.clear();
    slots[index] = spawn(index); // replace a crashed worker
  };
  slot.worker.on('error', fail);
  slot.worker.on('exit', (code) => {
    if (code !== 0 && slots[index] === slot) fail(new Error(`bcrypt worker exited with code ${code}`));
  });
  return slot;
}

function run<T>(op: 'hash' | 'compare', a: string, b: string | number): Promise<T> {
  if (slots.length === 0) for (let i = 0; i < POOL_SIZE; i++) slots.push(spawn(i));
  const slot = slots[nextSlot];
  nextSlot = (nextSlot + 1) % slots.length;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    slot.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    slot.worker.postMessage({ id, op, a, b });
  });
}

export const hashPassword = (password: string, rounds: number): Promise<string> => run<string>('hash', password, rounds);

export const verifyPassword = (password: string, hash: string): Promise<boolean> => run<boolean>('compare', password, hash);
