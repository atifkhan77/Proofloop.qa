---
trigger: always_on
description: Workspace rules for code auditing, security practices, static analysis, and code quality standards.
---

# Workspace Rule: Code Auditor & Quality Standards

This rule governs all code contributions, edits, and automated reviews within this workspace. All AI agents, subagents, and human contributors must comply with these guidelines.

---

## 1. Security Protocols & Defenses

1. **Zero Hardcoded Secrets**:
   - Never commit API keys, authentication tokens, passwords, private certificates, or cryptographic keys.
   - Use environment variables or designated secret management patterns.
   - If mock data is needed for tests, clearly mark it as dummy data (e.g., `test-fake-token-12345`).

2. **Input Validation & Sanitization**:
   - Treat all external input (HTTP request bodies, query params, headers, CLI arguments, file uploads, third-party webhook payloads) as untrusted.
   - Validate input against explicit schemas (e.g., Zod, Joi, Pydantic, or strict type-checkers).
   - Sanitize data before persistence or output rendering to prevent SQL injection, NoSQL injection, and Cross-Site Scripting (XSS).

3. **Safe File & Command Operations**:
   - Prevent Path Traversal: Resolve and canonicalize file paths, ensuring operations stay strictly within designated root directories.
   - Never pass raw strings to shell execution (`eval`, `exec`, unescaped string interpolation in commands).

---

## 2. Code Quality & Architecture

1. **SOLID & Clean Code Principles**:
   - **Single Responsibility**: Every function, module, and class should have one well-defined reason to change.
   - **Modularity & Decoupling**: Keep modules self-contained with minimal cross-boundary coupling.
   - **No Duplication (DRY)**: Abstract shared logic once it appears in multiple locations, while avoiding premature over-abstraction.

2. **Complexity & Function Length**:
   - Keep functions focused and concise (ideally under 50 lines).
   - Minimize nesting depth (avoid more than 3 levels of indentation); use early return guards.
   - Limit cyclomatic complexity: break complex branching logic into smaller helper functions.

3. **Type Safety & Contracts**:
   - Enforce strict typing. Avoid using `any` or untyped data containers where concrete types or interfaces can be declared.
   - Document edge cases, parameter expectations, and return contracts for public interfaces.

---

## 3. Error Handling & Observability

1. **Explicit Error Handling**:
   - Never swallow exceptions silently (e.g., empty `catch` blocks or `except: pass`).
   - Use strongly-typed, domain-specific error classes where appropriate.
   - Log errors with contextual information (operation name, entity ID, failure reason), ensuring no sensitive customer or credential data is logged.

2. **Resource Management**:
   - Guarantee deterministic cleanup of open file handles, database connections, and network sockets using `try...finally`, `using`, or context managers (`with`).
   - Prevent asynchronous race conditions and unhandled Promise rejections.

---

## 4. Code Review & Pre-Commit Checklist

Before finalizing any code change, verify that:
- [ ] No secrets, keys, or sensitive credentials are included.
- [ ] Code passes all linting and type-checking rules without warnings.
- [ ] Error conditions and edge cases are handled gracefully.
- [ ] No regression or performance bottleneck is introduced.
- [ ] Code follows existing project conventions, formatting, and naming styles.
