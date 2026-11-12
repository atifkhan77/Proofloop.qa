---
trigger: always_on
description: Workspace rules for automated testing, test organization, mocking practices, and verification quality gates.
---

# Workspace Rule: Testing Standards & Quality Gates

This rule sets the mandatory standards for automated testing across the workspace. All features, bug fixes, and refactorings must be validated through these testing guidelines.

---

## 1. Testing Philosophy & Structure

1. **Testing Pyramid**:
   - **Unit Tests**: The foundation. Fast, deterministic, isolated tests verifying individual units/functions.
   - **Integration Tests**: Validate interactions between connected modules, persistence layers, and external service adapters.
   - **End-to-End (E2E) Tests**: High-level tests validating critical user journeys and core system workflows.

2. **The AAA Pattern (Arrange-Act-Assert)**:
   Every test case must follow the AAA structure:
   - **Arrange**: Set up test data, mocks, and execution environment prerequisites.
   - **Act**: Execute the specific function or operation being tested.
   - **Assert**: Verify expected outcomes, return values, state changes, and side-effects.

3. **Descriptive Test Naming**:
   - Test names must clearly describe the scenario, input condition, and expected outcome.
   - Examples:
     - `calculateDiscount_withExpiredCoupon_throwsInvalidCouponException`
     - `getUserProfile_whenUserExists_returnsUserProfile`
     - `givenUnauthenticatedUser_whenAccessingDashboard_returns401Unauthorized`

---

## 2. Test Isolation & Determinism

1. **Zero Flakiness**:
   - Tests must run deterministically in any order and across multiple runs.
   - Never rely on real-time delays, sleeps, or external live network dependencies in unit tests.
   - Use mock clocks / fake timers for time-dependent operations.

2. **Isolated Test State**:
   - Reset shared test fixtures, temporary directories, and in-memory databases before/after each test (`beforeEach` / `afterEach` / `tearDown`).
   - Tests must not leak state into other test cases.

---

## 3. Mocking & Stubbing Guidelines

1. **Mock at Boundaries**:
   - Mock external systems (HTTP endpoints, third-party APIs, message queues, disks, external databases).
   - Do **not** mock internal implementation details of the unit under test.
   - Prefer lightweight in-memory fakes over fragile, over-specified mock expectations where possible.

2. **Avoid Mock Overuse**:
   - If a test tests only mocks and no real logic, it provides false confidence. Verify actual component behavior and state changes.

---

## 4. Regression Prevention & Verification Gates

1. **Bug Fix Protocol**:
   - When fixing a bug, write a test case reproducing the reported defect **first**.
   - Verify that the reproduction test fails with the existing code.
   - Implement the fix and verify that the reproduction test now passes.

2. **Pre-Completion Quality Gate**:
   - Before reporting any coding task as complete, the agent must run the workspace test runner command using `run_command`.
   - All tests must pass with exit code 0.
   - Any failing test must be diagnosed and resolved before task completion.
