import { config } from './config'; // loads .env and validates secrets first

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './db';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import moduleRoutes from './routes/module.routes';
import riskRoutes from './routes/risk.routes';
import testCaseRoutes from './routes/test-case.routes';
import traceabilityRoutes from './routes/traceability.routes';
import automationRoutes from './routes/automation.routes';
import environmentRoutes from './routes/environment.routes';
import apiIntelligenceRoutes from './routes/api-intelligence.routes';
import environmentVariableRoutes from './routes/environment-variable.routes';
import defectRoutes from './routes/defect.routes';
import organizationRoutes from './routes/organization.routes';
import integrationRoutes from './routes/integration.routes';
import testCycleRoutes from './routes/test-cycle.routes';
import reportRoutes from './routes/report.routes';
import qualityGateRoutes from './routes/quality-gate.routes';
import aiRoutes from './routes/ai.routes';
import evidenceRoutes from './routes/evidence.routes';
import databaseSentinelRoutes from './routes/database-sentinel.routes';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
// Only the web app's origin(s); requests without an Origin header (curl, server-to-server) are unaffected.
app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Total-Count'] }));
// gzip/brotli-negotiated responses > 1 KB (JSON lists shrink ~85-90%, PERF-03).
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', environmentRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api', riskRoutes); // defines /projects/:id/risks and /requirements/:id/risks
app.use('/api', testCaseRoutes); // defines /projects/:id/test-cases and /test-cases/:id
app.use('/api', traceabilityRoutes); // defines /projects/:id/traceability
app.use('/api', automationRoutes); // defines /projects/:id/automation and /automation/:id/executions
app.use('/api', apiIntelligenceRoutes); // defines /projects/:id/api-collections and /api-collections/:id/requests
app.use('/api', environmentVariableRoutes); // defines /environments/:id/variables
app.use('/api', defectRoutes); // defines /projects/:id/defects and /defects/:id
app.use('/api', organizationRoutes); // defines /organization/users (ADMIN only)
app.use('/api', integrationRoutes); // defines /projects/:id/integrations
app.use('/api', testCycleRoutes); // defines /projects/:id/test-cycles and /test-cycles/:id
app.use('/api', reportRoutes); // defines /projects/:id/reports
app.use('/api', qualityGateRoutes); // defines /projects/:id/quality-gate/evaluate and config
app.use('/api', aiRoutes); // defines /requirements/:id/ai/... and /defects/:id/root-cause
app.use('/api', evidenceRoutes); // defines /projects/:id/evidence and /automation/executions/:id/evidence
app.use('/api', databaseSentinelRoutes); // defines /environments/:id/database/...

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    // Public endpoint: the driver message (host, port, database name) stays in the server log.
    console.error('[health] database check failed:', (err as Error).message);
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

// Last middleware: body-parser errors (malformed JSON, body > 1mb) and anything passed to next(err)
// get a JSON response. Express's default handler returns an HTML page with the stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const e = err as { status?: number; statusCode?: number; type?: string };
  const status = e.status ?? e.statusCode ?? 500;
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON in request body' });
  } else if (e.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
  } else if (status >= 400 && status < 500) {
    res.status(status).json({ error: 'Invalid request' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(config.port, () => {
  console.log(`PROOFLOOP API listening on http://localhost:${config.port}`);
});
