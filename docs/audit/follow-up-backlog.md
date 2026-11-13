# Atlas Consistency Audit - Follow-Up Backlog

**Created:** 2025-12-27 **Source:** Full Atlas Consistency Audit

This backlog contains tasks identified during the consistency audit that were too large or risky to
include in the initial PR.

---

## P1 - Do Soon (High Impact)

### 2. OpenAPI Contract Validation

**Type:** CI/CD enhancement **Effort:** 1-2 hours **Risk:** Low

**Actions:**

1. Add script to validate OpenAPI spec against implemented endpoints
2. Add to CI workflow
3. Document in `openapi/README.md`

---

## P2 - Nice to Have (Moderate Impact)

### 3. Stale Docs Cleanup

**Type:** Documentation **Effort:** 1 hour **Risk:** None **Status:** Partially addressed via the
claims register and `pnpm docs:check`

**Current State:**

- `docs/_archive/` contains pre-platform docs with archive warnings
- Canonical docs must not link to archive (enforced by `pnpm docs:check`)

**Remaining Actions:**

1. Periodically review archived content for sensitive or misleading excerpts
2. Keep claims register aligned with public docs

---

### 4. Breadcrumb Builder Tests

**Type:** Test coverage **Effort:** 2 hours **Risk:** None

**Actions:**

1. Add tests for `paramResolver` with async data fetching
2. Add tests for `inherit: false` behavior
3. Add edge case tests for malformed paths

---

### 5. Analytics E2E Test

**Type:** Integration test **Effort:** 1 hour **Risk:** Low

**Actions:**

1. Add Playwright test for analytics consent flow
2. Verify events blocked when consent is false
3. Verify events sent when consent is true

---

## P3 - Cosmetic (Low Impact)

### 6. Console Log Audit in Telemetry

**Type:** Code quality **Effort:** 30 min **Risk:** None

**Current State:**

- `console.log` allowed in telemetry module via ESLint override
- Used for debug output

**Actions:**

1. Audit all console.log usage
2. Consider using debug flag consistently
3. Add structured logging where appropriate

---

## Notes

- Tasks are prioritized by impact and risk
- Each task should be a separate PR
- Include relevant tests with each change
- Update this file as tasks are completed

## Completed Tasks

| Task                        | Date       | PR            |
| --------------------------- | ---------- | ------------- |
| Sentry demo: use API client | 2025-12-27 | This audit PR |
| MSW v2 migration            | 2026-11-12 | MSW v2 PR     |
