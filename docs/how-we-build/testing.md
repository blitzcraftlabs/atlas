# Testing

> Use `renderWithProviders`. Mock the network, not the hooks.

## The Rules

| Rule                           | Enforcement                      |
| ------------------------------ | -------------------------------- |
| **Use `renderWithProviders`**  | It includes all providers        |
| **Mock APIs with MSW**         | Not React Query internals        |
| **Use fixtures for responses** | Not inline mock data             |
| **Use factories for entities** | Deterministic test data          |
| **Query by accessibility**     | Role, label, text — not test IDs |

## Setup

```
src/test/
├── helpers/
│   ├── render.tsx          # renderWithProviders
│   ├── reactQuery.ts       # Test query client
│   └── router.ts           # Next.js router mocks
├── fixtures/               # API response shapes
├── factories/              # Entity factories
├── setup/
│   ├── msw.ts              # MSW server
│   └── env.ts              # Test environment
└── index.ts                # Central exports
```

## Basic Component Test

```tsx
import { renderWithProviders } from "@/test";
import { screen } from "@testing-library/react";

test("renders user name", async () => {
  const { user } = renderWithProviders(<UserProfile userId="123" />);

  // Wait for async content
  expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();

  // Interact
  await user.click(screen.getByRole("button", { name: /edit/i }));
});
```

## renderWithProviders

The primary test helper. Wraps component with all necessary providers.

```tsx
import { renderWithProviders } from "@/test";

const { user, queryClient } = renderWithProviders(<MyComponent />, {
  // Optional: initial route
  route: "/users/123",
  searchParams: { tab: "settings" },

  // Optional: feature flags
  featureFlags: { example_feature: true },
});

// user — for simulating interactions
await user.click(button);

// queryClient — for cache inspection
const data = queryClient.getQueryData(["users"]);
```

## Fixtures vs Factories

### Fixtures — API Response Shapes

Use for **consistent API responses**:

```typescript
import { fixtures } from "@/test";
import { http, HttpResponse } from "msw";

// Success response
server.use(
  http.get("*/users/:id", () => {
    return HttpResponse.json(fixtures.api.userDetailSuccess());
  })
);

// Error response
server.use(
  http.get("*/users/:id", () => {
    return HttpResponse.json(fixtures.errors.error404, { status: 404 });
  })
);
```

### Factories — Entity Generation

Use for **generating test data**:

```typescript
import { userFactory, projectFactory } from "@/test";

// Single entity
const user = userFactory.build();

// With overrides
const admin = userFactory.build({ email: "admin@example.com" });

// Multiple entities
const users = userFactory.buildList(5);

// Related entities
const project = projectFactory.build({ ownerId: user.id });
```

## MSW (Mock Service Worker)

Atlas uses **MSW v2** (`http` handlers returning `HttpResponse`). Default handlers are already set
up in `src/test/setup/msw.ts`. Override per-test with `server.use(...)`; overrides reset after each
test.

```typescript
import { server } from '@/test';
import { http, HttpResponse } from 'msw';

test('handles loading error', async () => {
  server.use(
    http.get('*/users', () => {
      return HttpResponse.json({ error: 'Failed' }, { status: 500 });
    })
  );

  renderWithProviders(<UserList />);

  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
```

Handlers receive `{ request, params }`. Read query strings with `new URL(request.url).searchParams`
and bodies with `await request.json()`. The shared handlers import Node's `URL` because
`jest.setup.js` replaces the global `URL` with a partial mock.

**Jest environment.** Application Jest projects run in
[`jest-fixed-jsdom`](https://github.com/mswjs/jest-fixed-jsdom), which keeps Node's `fetch`,
`Request`, `Response` and streams available inside jsdom. MSW v2 also depends on a few ESM-only
packages (`rettime`, `until-async`, `@open-draft/*`). `jest.config.js` compiles those to CommonJS
with `babel-jest`. If a future MSW release adds another ESM-only dependency, add it to the
`transformIgnorePatterns` allow-list.

## Query Priority

Use these queries in order (most to least preferred):

1. **Role** — `getByRole('button', { name: /submit/i })`
2. **Label** — `getByLabelText('Email')`
3. **Placeholder** — `getByPlaceholderText('Search...')`
4. **Text** — `getByText('Welcome')`
5. **Test ID** — `getByTestId('submit-btn')` ← Last resort

## Common Patterns

### Loading State

```typescript
import { delay, http, HttpResponse } from 'msw';

test('shows loading spinner', async () => {
  server.use(
    http.get('*/users', async () => {
      await delay(100);
      return HttpResponse.json([]);
    })
  );

  renderWithProviders(<UserList />);

  expect(screen.getByRole('status')).toBeInTheDocument();
  await screen.findByText('No users');
});
```

### Form Submission

```typescript
test('submits form', async () => {
  const { user } = renderWithProviders(<CreateUserForm />);

  await user.type(screen.getByLabelText(/name/i), 'John');
  await user.type(screen.getByLabelText(/email/i), 'john@example.com');
  await user.click(screen.getByRole('button', { name: /submit/i }));

  expect(await screen.findByText(/created/i)).toBeInTheDocument();
});
```

### Error State

```typescript
test('displays validation error', async () => {
  server.use(
    http.post('*/users', () => {
      return HttpResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid email' },
        { status: 400 }
      );
    })
  );

  const { user } = renderWithProviders(<CreateUserForm />);

  await user.click(screen.getByRole('button', { name: /submit/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
});
```

### Hook Testing

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test";

test("useUser fetches user data", async () => {
  const { result } = renderHook(() => useUser("user-1"), {
    wrapper: createQueryWrapper(),
  });

  expect(result.current.isLoading).toBe(true);

  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(result.current.data).toMatchObject({ id: "user-1" });
});
```

## What Not To Do

```typescript
// ❌ Query by test ID first
screen.getByTestId("submit-button");

// ❌ Mock React Query hooks
jest.mock("@tanstack/react-query");

// ❌ Inline mock data
server.use(http.get("*", () => HttpResponse.json({ id: 1, name: "Test" })));

// ❌ Use getBy for async content
screen.getByText("Loading..."); // Use findBy instead

// ❌ Not awaiting user events
user.click(button); // Missing await
```

```typescript
// ✅ Query by role
screen.getByRole("button", { name: /submit/i });

// ✅ Mock the API layer
server.use(http.get("*/users", () => HttpResponse.json(fixtures.users)));

// ✅ Use findBy for async
await screen.findByText("Welcome");

// ✅ Await user events
await user.click(button);
```

## Repository aggregate coverage

`pnpm test:coverage:all` measures first-party Atlas logic that already has automated tests. It is
**reporting**, not a quality score and not a merge gate.

Use it for:

- public Codecov visibility (dynamic README badge)
- finding untested areas
- merging coverage from web, reference, UI, CLI, project-contract, consent, and root scripts

Do **not** treat the Codecov percentage as a guarantee. There is no repository-wide coverage floor.

## Risk-based coverage

Atlas does **not** aim for repository-wide 80% coverage. Critical owned subsystems must not regress:

```bash
pnpm test:risk-coverage
```

That command collects Jest coverage for `@atlas/web` and `@atlas/ui`, then evaluates
[`coverage-policy.json`](../../coverage-policy.json) via `scripts/coverage-policy.mjs`. Missing
reports, missing subsystems, zero matched files, or a metric below the floor fail the gate. CI
collects the full aggregate once (`pnpm test:coverage:all`) without also running `pnpm test`, then
runs the same policy evaluator. Architecture boundary tests run via `pnpm test:boundaries`.
`pnpm test:risk-coverage` remains the local command that regenerates the two high-risk reports and
evaluates floors.

Suggested floors (do not lower them just to make CI green):

| Subsystem                | statements/lines | branches | functions |
| ------------------------ | ---------------- | -------- | --------- |
| web auth, web API        | ≥ 85%            | ≥ 75%    | ≥ 85%     |
| UI forms, owned UI logic | ≥ 80%            | ≥ 70%    | ≥ 80%     |

Update floors in `coverage-policy.json` only with an explicit residual-risk note in
[testing-risk-matrix.md](testing-risk-matrix.md).

Codecov upload is **reporting**. Local CI already enforced the floors. `fail_ci_if_error: false` on
the Codecov step must not be treated as the coverage policy. Current Codecov GitHub App / token
status lives in [repository integrations](repository-integrations.md).

The failure fixture `scripts/__fixtures__/coverage-policy/below-threshold-web-api.json` proves a
HIGH-risk subsystem below threshold exits non-zero (`pnpm test:scripts`).

Full failure-mode table: [testing-risk-matrix.md](testing-risk-matrix.md). Auth/session tests
intersect [security.md](security.md); do not duplicate the threat model.

## Storybook UI quality

Storybook complements Jest and application E2E — it does not replace them.

| Layer                        | Command                                                | Scope                     |
| ---------------------------- | ------------------------------------------------------ | ------------------------- |
| Storybook build              | `pnpm --filter @atlas/ui build-storybook`              | Every story compiles      |
| Critical story policy        | `node scripts/storybook-critical-policy.mjs`           | Protected tags/play/axe   |
| Interaction + axe            | `pnpm --filter @atlas/ui test:storybook`               | `critical`-tagged stories |
| Cross-browser keyboard/focus | `pnpm --filter @atlas/ui test:storybook:cross-browser` | Chromium + WebKit         |
| Visual regression            | `pnpm --filter @atlas/ui test:visual`                  | Chromium pixel baselines  |

CI runs these in the **UI Quality** workflow with path filtering for `packages/ui/**`, Storybook
critical-policy scripts, and related shared config. Pixel baselines are Chromium-only captures from
`mcr.microsoft.com/playwright:v<playwright-version>-noble` with `maxDiffPixelRatio: 0.005`; WebKit
is exercised for interaction, not screenshots. Generated consumers that `atlas enable visual` use
the same image via `pnpm --filter @atlas/ui test:visual:docker` and a comparison workflow that never
updates snapshots.

Details: `packages/ui/.storybook/README.md`.

## Browser and viewport policy

Required CI Playwright projects: **Chromium** and **WebKit**. Firefox is not a required CI browser.

Critical navigation is covered at desktop width and one agreed narrow viewport (**390×844**) in the
reference suite. Do not duplicate the entire E2E matrix per viewport.

## Flake policy

| Suite                 | Retries            | Flake handling                                                     |
| --------------------- | ------------------ | ------------------------------------------------------------------ |
| Jest unit/integration | None               | Fail the job                                                       |
| Playwright            | `retries: 2` on CI | `failOnFlakyTests: true` on CI so a retry-pass still fails the run |

A flaky test is one that both fails and passes in the same CI invocation (Playwright `flaky`
status). Reproduce locally with `--repeat-each=10` on the named spec. Quarantine requires a linked
GitHub issue, owner, and expiry. Do not use permanent `test.skip()` as a flake strategy.

## Runtime expectations

Keep PR suites practical. Prefer fake timers and Playwright routing over real sleeps or live
vendors. If one area becomes disproportionately expensive, change topology (narrower specs,
parallelism where deterministic) rather than deleting risk coverage.

## Running Tests

```bash
# All workspace Jest tests + script tests
pnpm test

# Script tests only (includes coverage-policy fixtures)
pnpm test:scripts

# Critical subsystem coverage gate
pnpm test:risk-coverage

# Repository aggregate (measurement / Codecov; not a floor)
pnpm test:coverage:all

# Watch mode
pnpm test:watch

# Package coverage (feeds the risk gate)
pnpm --filter @atlas/web test:coverage
pnpm --filter @atlas/ui test:coverage

# Specific file
pnpm test src/features/users/UserList.test.tsx

# E2E (Chromium + WebKit)
pnpm --filter @atlas/web test:e2e
pnpm --filter @atlas/reference test:e2e
```

## Troubleshooting

| Problem                 | Solution                                      |
| ----------------------- | --------------------------------------------- |
| "Not wrapped in act"    | Use `await` with user events and `findBy`     |
| Test timeout            | Using `getBy` for async content? Use `findBy` |
| MSW not intercepting    | Check URL pattern matches request             |
| Router mock not working | Call `resetRouterMocks()` in `beforeEach`     |

## Related

- [Shared Jest config](../../packages/config/jest.config.js)
- [Web app Jest setup](../../apps/web/jest.setup.js)
- [UI package Jest setup](../../packages/ui/jest.setup.js)
