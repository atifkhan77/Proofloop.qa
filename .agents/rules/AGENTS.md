# AGENTS.md (Workspace Rules)

This document serves as the top-level workspace rule index for Google Antigravity and the open `AGENTS.md` standard.

---

## Workspace Rules

- **Code Auditor & Quality Standards**: [`.agents/rules/code-auditor.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/rules/code-auditor.md)
- **Testing Standards & Quality Gates**: [`.agents/rules/testing-standards.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/rules/testing-standards.md)

## Subagent Definitions

- **Code Auditor**: [`.agents/agents/code-auditor.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/code-auditor.md)
- **Test Engineer**: [`.agents/agents/test-engineer.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/test-engineer.md)
- **Architect**: [`.agents/agents/architect.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/architect.md)
- **Developer**: [`.agents/agents/developer.md`](file:///c:/Users/muhammad.atif.67/Documents/Workspace/TestProject/.agents/agents/developer.md)

---

## Core Tenets

1. **Security**: Validate all inputs, escape outputs, avoid command execution vulnerabilities, and never commit secrets.
2. **Quality**: Adhere to clean code practices, maintain low cyclomatic complexity, and follow language idioms.
3. **Verification**: Verify all changes with automated tests following the AAA pattern before completing tasks.
