import path from 'node:path';
import dotenv from 'dotenv';

// Load the root .env BEFORE importing the Prisma client (it reads DATABASE_URL on first query).
// src/ and dist/ are both three levels below the repo root.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma, Prisma } from '@proofloop/prisma';
import { runInSandbox } from './sandbox';

/** Slack incoming webhooks live on https://hooks.slack.com only. */
function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && (url.port === '' || url.port === '443');
  } catch {
    return false;
  }
}

/** Must match apps/api/src/lib/queue.ts. */
const EXECUTION_QUEUE = 'automation-executions';

interface ExecutionJobData {
  executionId: string;
  automationProjectId: string;
  repository: string | null;
  branch: string | null;
  framework: string;
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';
// Workers require maxRetriesPerRequest: null (BullMQ blocking commands).
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function processExecution(job: Job<ExecutionJobData>): Promise<void> {
  const { executionId, framework } = job.data;
  console.log(`[Job ${job.id}] Starting execution ${executionId} (${framework})`);

  // Only PENDING (or RUNNING, when BullMQ re-delivers a stalled job) may start. A run that was
  // CANCELLED, already finished, or deleted with its organization is skipped, not resurrected.
  const started = await prisma.automationExecution.updateMany({
    where: { id: executionId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'RUNNING', startTime: new Date() },
  });
  if (started.count === 0) {
    console.log(`[Job ${job.id}] Execution ${executionId} no longer runnable (deleted or not PENDING); skipped`);
    return;
  }

  try {
    // Read config from the DB at run time (not the job payload): repository/branch may have
    // changed since the job was queued, and scripts must be APPROVED at execution time.
    const execution = await prisma.automationExecution.findUnique({
      where: { id: executionId },
      include: {
        automationProject: {
          include: { scripts: { where: { status: 'APPROVED' }, select: { fileName: true, code: true } } },
        },
        projectEnvironment: { include: { variables: { select: { key: true, value: true, isSecret: true } } } },
      },
    });
    if (!execution) {
      console.log(`[Job ${job.id}] Execution ${executionId} deleted before it started`);
      return;
    }

    const outcome = await runInSandbox({
      executionId,
      repository: execution.automationProject.repository,
      branch: execution.automationProject.branch,
      scripts: execution.automationProject.scripts,
      baseUrl: execution.projectEnvironment?.baseUrl ?? null,
      variables: execution.projectEnvironment?.variables ?? [],
    });
    const { status, passedCount, failedCount, skippedCount } = outcome;

    const finished = await prisma.automationExecution.updateMany({
      where: { id: executionId, status: 'RUNNING' },
      data: {
        status,
        endTime: new Date(),
        passedCount,
        failedCount,
        skippedCount,
        logs: outcome.logs,
        results: outcome.results as unknown as Prisma.InputJsonValue,
      },
    });
    if (finished.count === 0) {
      console.log(`[Job ${job.id}] Execution ${executionId} removed or changed while running; result discarded`);
      return;
    }

    if (status === 'FAILED') {
      try {
        const execRecord = await prisma.automationExecution.findUnique({
          where: { id: executionId },
          include: { automationProject: { include: { project: true } } },
        });
        if (execRecord) {
          const integration = await prisma.integration.findFirst({
            where: { projectId: execRecord.automationProject.projectId, type: 'SLACK', enabled: true },
          });
          // SSRF: the worker has no DNS-checking agent, so it only posts to Slack's own
          // webhook host over https and never follows redirects.
          if (integration?.webhookUrl && isSlackWebhookUrl(integration.webhookUrl)) {
            await fetch(integration.webhookUrl, {
              method: 'POST',
              redirect: 'manual',
              signal: AbortSignal.timeout(10_000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: `🚨 [ProofLoop] Automation Execution ${execRecord.runId} FAILED in project ${execRecord.automationProject.project.name}`,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*🚨 Playwright Automation Execution Failed*\n*Project:* ${execRecord.automationProject.project.name}\n*Run ID:* ${execRecord.runId}\n*Trigger:* ${execRecord.trigger}\n*Results:* :x: ${failedCount} Failed | :white_check_mark: ${passedCount} Passed`,
                    },
                  },
                ],
              }),
            });
          }
        }
      } catch (slackErr) {
        console.error(`[Job ${job.id}] Slack alert failed:`, slackErr);
      }
    }

    console.log(`[Job ${job.id}] Completed execution ${executionId} - Status: ${status}`);
  } catch (error) {
    console.error(`[Job ${job.id}] Execution crashed`, error);
    await prisma.automationExecution
      .updateMany({
        where: { id: executionId, status: 'RUNNING' },
        data: { status: 'FAILED', endTime: new Date() },
      })
      .catch((err: unknown) => console.error(`[Job ${job.id}] Could not mark execution FAILED`, err));
    throw error;
  }
}

// Each run is a Docker container with up to SANDBOX_CPUS/SANDBOX_MEMORY: keep parallel runs low.
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
const worker = new Worker<ExecutionJobData>(EXECUTION_QUEUE, processExecution, { connection, concurrency });

worker.on('ready', () => {
  // Playwright's webServer config waits for this line before running tests.
  console.log('PROOFLOOP Worker ready. Listening for execution jobs...');
});

worker.on('failed', (job, err) => {
  console.error(`[Job ${job?.id}] Failed completely: ${err.message}`);
});

// Log connection/processing errors (e.g. Redis restarts). The worker reconnects on its own.
worker.on('error', (err) => {
  console.error(`[worker] ${err.message}`);
});

// Graceful shutdown: let the in-flight job finish, then close connections.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, closing...`);
  await worker.close();
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
