# ProofLoop QA — Enterprise Quality Engineering Platform

An autonomous, full-lifecycle Enterprise Quality Assurance and Test Intelligence platform built with React 19, Node.js/Express, Prisma ORM, BullMQ, Redis, PostgreSQL, and Playwright.

---

## Highlights

- **16 Core QA Modules**: End-to-end coverage across Requirements, Test Cases, Automation Lab, API Testing, Defect Lifecycle, and Release Gates.
- **AI-Powered QA Intelligence**: Automated requirement refinement, defect root-cause analysis, and AI-assisted Playwright script generation.
- **Distributed Automation Lab**: Sandboxed, containerized Playwright test executions powered by BullMQ queues and Redis.
- **API Intelligence & Testing**: Collections, parameterized requests, JSONPath assertions, and strict 3-layer SSRF defenses.
- **Full-Spectrum Traceability**: Real-time requirement-to-test-to-defect coverage matrices.
- **Quality Gates & Observability**: Automated pass/fail release gating, Slack/Jira integrations, and health metrics.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       React 19 + Vite 6 Web UI        |
                      |        (Tailwind CSS v4, Port 5173)   |
                      +-------------------+-------------------+
                                          |
                                          | REST API (JWT / RBAC)
                                          v
                      +---------------------------------------+
                      |         Node.js / Express API         |
                      |        (Cluster Mode, Port 4000)      |
                      +---------+-------------------+---------+
                                |                   |
                 Prisma Queries |                   | Enqueue Runs
                                v                   v
                     +--------------------+   +-------------------+
                     | PostgreSQL 16      |   | Redis 7 (BullMQ)  |
                     | (Port 5433)        |   | (Port 6380)       |
                     +--------------------+   +---------+---------+
                                                        |
                                                        | Dequeue Jobs
                                                        v
                                              +-------------------+
                                              | Playwright Worker |
                                              | (Docker Sandbox)  |
                                              +-------------------+
```

---

## Monorepo Structure

```
.
├── .agents/                 # Antigravity custom AI subagents & workspace rules
├── AGENTS.md                # Open AGENTS.md standard workspace index
├── proofloop-qa/
│   ├── apps/
│   │   ├── api/             # Express 4 backend (routes, controllers, middlewares)
│   │   ├── web/             # React 19 SPA (Vite, Tailwind, Recharts)
│   │   └── worker/          # BullMQ background automation execution worker
│   ├── packages/
│   │   ├── prisma/          # Prisma schema, migrations, and seed scripts
│   │   ├── playwright-engine/# Headless browser execution harness
│   │   ├── ai-engine/       # LLM provider abstractions & prompt pipelines
│   │   ├── database-sentinel/# Safe read-only transactional query engine
│   │   └── shared/          # Common types, schemas, and utilities
│   ├── docker-compose.yml   # Multi-service infrastructure (Postgres 16, Redis 7)
│   └── package.json         # Workspace root configuration
└── README.md
```

---

## Quick Start

### Prerequisites
- Node.js >= 20.0.0
- Docker Desktop (for PostgreSQL & Redis)
- npm >= 10.0.0

### 1. Clone & Install Dependencies
```bash
git clone <your-repo-url>
cd TestProject/proofloop-qa
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update configuration parameters (database credentials, Redis host, and optional AI provider API keys).

### 3. Spin Up Infrastructure
```bash
npm run infra:up
```
*Starts PostgreSQL on `localhost:5433` and Redis on `localhost:6380`.*

### 4. Initialize Database & Seed Demo Data
```bash
# Push Prisma schema to the database
npm run db:push

# Seed demo e-commerce project with full test data
node packages/prisma/scripts/seed-demo-data.cjs

# Seed defect intelligence log
node packages/prisma/scripts/seed-issue-log.cjs
```

### 5. Start Development Servers
```bash
# Terminal 1: Starts API (port 4000) and Web App (port 5173)
npm run dev

# Terminal 2: Starts the BullMQ background test worker
npm run worker
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Testing & Quality Assurance

Run the end-to-end regression test suite:
```bash
# Run all Playwright regression tests (289+ specs)
npm run test:e2e -w @proofloop/web
```

---

## AI Agent Collaboration

This repository adheres to the **AGENTS.md** standard and Google Antigravity customization guidelines located in `.agents/`:
- **`code-auditor`**: Enforces zero-credential tolerance, static analysis, and input sanitization.
- **`test-engineer`**: Validates changes against the AAA pattern and runs automated test suites.
- **`architect`**: Manages system modularity, clean boundaries, and API contracts.
- **`developer`**: Delivers production-ready features and bug fixes adhering to repository rules.

---

## License

This project is licensed under the MIT License.

