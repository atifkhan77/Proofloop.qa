# AGENTS.md

Welcome to the **TestProject** workspace. This repository follows the open `AGENTS.md` specification and Google Antigravity customization guidelines to configure AI agents, subagents, and automated quality workflows.

---

## 1. Workspace Overview

- **Project Name**: TestProject
- **Customization System**: Google Antigravity (`.agents/`)
- **Agent Configuration Directory**: `.agents/agents/`
- **Workspace Rules Directory**: `.agents/rules/`

---

## 2. Active Custom Agents & Subagents

Custom subagents are modular agents declared in `.agents/agents/`. Each agent possesses a dedicated persona, tailored tool grants, and isolated context window to execute complex multi-step workflows.

| Agent Name | Config Path | Role & Capabilities |
| :--- | :--- | :--- |
| **`code-auditor`** | [`.agents/agents/code-auditor.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/code-auditor.md) | Security auditing, code smell detection, static analysis, and code quality enforcement. |
| **`test-engineer`** | [`.agents/agents/test-engineer.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/test-engineer.md) | Test authoring, test suite execution, coverage verification, and regression prevention. |
| **`architect`** | [`.agents/agents/architect.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/architect.md) | System architecture design, API contract specifications, modularization, and refactoring plans. |
| **`developer`** | [`.agents/agents/developer.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/developer.md) | Core feature implementation, bug fixing, refactoring, and code generation adhering to workspace rules. |

Coordinator agents can invoke these subagents dynamically using the `invoke_subagent` tool.

---

## 3. Workspace Rules & Standards

All agent actions in this workspace must strictly adhere to the following rules:

1. **Code Auditor Rule**: [`.agents/rules/code-auditor.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/rules/code-auditor.md)
   - Mandatory static analysis, security scanning (OWASP Top 10), and code hygiene.
   - Zero tolerance for hardcoded credentials, plain-text secrets, or unvalidated inputs.

2. **Testing Standards Rule**: [`.agents/rules/testing-standards.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/rules/testing-standards.md)
   - Arrange-Act-Assert (AAA) pattern for all automated tests.
   - All bug fixes must include a regression test proving the fix.
   - Test suites must be executed and confirmed passing before closing tasks.

### Rule Inclusions

@[code-auditor](.agents/rules/code-auditor.md)
@[testing-standards](.agents/rules/testing-standards.md)

---

## 4. Core Development Guidelines for AI Agents

1. **Inspect Before Modifying**:
   - Always read existing files, dependency manifests, and configurations before writing or editing code.
   - Maintain consistency with the existing directory conventions and coding idioms.

2. **Minimal and Atomic Edits**:
   - Make precise, targeted changes. Avoid unnecessary refactoring or reformatting of untouched code.
   - Never introduce regressions or break existing public interfaces without explicit instruction.

3. **Verify Everything**:
   - Run relevant linters, build checks, and automated tests after making changes.
   - Inspect tool command outputs and resolve warnings/failures immediately.
