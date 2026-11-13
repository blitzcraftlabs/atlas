# Environment Variables

> Environment variables are contracts. Validate them, type them, document them.

## The Rules

| Rule                                    | Enforcement                       |
| --------------------------------------- | --------------------------------- |
| **Never use `process.env` directly**    | Import from `@/env` instead       |
| **All vars validated with Zod**         | Build fails on invalid config     |
| **Client vars prefixed `NEXT_PUBLIC_`** | Only these are bundled to browser |
| **Server vars never exposed to client** | TypeScript + bundle separation    |
| **Document every variable**             | In `.env.example` with comments   |

## Setup Profiles

| Profile                   | Required variables                                                                                                          | Use case                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Local template**        | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`                                                                                | `/examples` routes with mocked APIs                                                                         |
| **Reference application** | `apps/reference/.env.local`: `NEXT_PUBLIC_API_URL=/api`, `AUTH_SESSION_SECRET`, `NEXT_PUBLIC_APP_URL=http://localhost:3001` | Zero-credential auth + users API in `apps/reference` — see [reference-harness.md](./reference-harness.md)   |
| **OAuth**                 | Above + `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SESSION_SECRET`                                                   | Auth API routes when wired in product                                                                       |
| **OIDC**                  | Above (session secret) + `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, optional `AUTH_OIDC_CLIENT_SECRET` / `AUTH_OIDC_SCOPES` | `/api/auth/oidc/*` against any OpenID Connect issuer ([ADR-0012](../adr/0012-consumer-extension-points.md)) |
| **Database-backed**       | Above + `DATABASE_URL`                                                                                                      | Features that connect to PostgreSQL                                                                         |
| **Production**            | All production secrets including `DATABASE_URL`                                                                             | CI (`NODE_ENV=production`) and deploy                                                                       |

`DATABASE_URL` is optional in the Zod schema for local development. The `validate:env` script
requires it only when `NODE_ENV=production`.

## Architecture

```
src/
├── env.ts                     # Unified exports (clientEnv, serverEnv)
├── env/
│   ├── public-env.ts          # Client-safe variables
│   └── server-env.ts          # Server-only variables
└── schemas/env/
    ├── public-runtime-config.ts   # Client var schemas
    └── server-runtime-config.ts   # Server var schemas
```

## Usage

### In Client Components

```typescript
"use client";
import { clientEnv } from "@/env";

function MyComponent() {
  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;
  // ✅ Type-safe, validated
}
```

### In Server Components / API Routes

```typescript
import { serverEnv } from "@/env";

export async function GET() {
  const dbUrl = serverEnv.DATABASE_URL;
  // ✅ Only accessible server-side
}
```

## Adding a New Environment Variable

### Step 1: Define the Schema

**For client variables** (`src/schemas/env/public-runtime-config.ts`):

```typescript
export const ClientEnvSchema = {
  // Existing...
  NEXT_PUBLIC_API_URL: z.string().url(),

  // Add yours
  NEXT_PUBLIC_FEATURE_X: z.enum(["enabled", "disabled"]).default("disabled"),
};
```

**For server variables** (`src/schemas/env/server-runtime-config.ts`):

```typescript
export const ServerEnvSchema = {
  // Existing...
  DATABASE_URL: z.string().url().optional(),

  // Add yours
  STRIPE_SECRET_KEY: z.string().min(32),
};
```

### Step 2: Add Runtime Binding

**Client** (`src/env/public-env.ts`):

```typescript
runtimeEnv: {
  // Existing...
  NEXT_PUBLIC_FEATURE_X: process.env.NEXT_PUBLIC_FEATURE_X,
}
```

**Server** (`src/env/server-env.ts`):

```typescript
runtimeEnv: {
  // Existing...
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
}
```

### Step 3: Update Validation Script

Edit `scripts/validate-env.ts` to include the new variable.

### Step 4: Document

Add to `.env.example`:

```bash
# Feature X toggle
# Options: enabled | disabled
# Default: disabled
NEXT_PUBLIC_FEATURE_X=disabled

# Stripe secret key
# Generate at: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_...
```

### Step 5: Validate

```bash
pnpm validate:env
```

## Common Patterns

### URL Validation

```typescript
NEXT_PUBLIC_API_URL: z.string().url(),
```

### Enum Values

```typescript
NODE_ENV: z.enum(['development', 'test', 'production']),
LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
```

### Numbers

```typescript
PORT: z.coerce.number().min(1024).max(65535).default(3000),
```

### Optional with Default

```typescript
REDIS_URL: z.string().url().optional(),
SESSION_TTL: z.coerce.number().default(604800), // 7 days
```

### Boolean Flags

```typescript
ENABLE_ANALYTICS: z
  .enum(['true', 'false'])
  .transform(val => val === 'true')
  .default('false'),
```

## What Not To Do

```typescript
// ❌ Direct process.env access
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// ❌ Inline fallbacks (defeats validation)
const url = process.env.API_URL || 'http://localhost:3000';

// ❌ Server secrets with NEXT_PUBLIC_ prefix
const secret = process.env.NEXT_PUBLIC_JWT_SECRET; // EXPOSED TO CLIENT!

// ❌ Unvalidated strings
const whatever: z.string(); // No format validation
```

```typescript
// ✅ Always use env module
import { clientEnv, serverEnv } from "@/env";

const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;
const dbUrl = serverEnv.DATABASE_URL;
```

## CI/CD Integration

Environment validation runs automatically in CI when application code changes:

```yaml
# .github/workflows/ci.yml (CI job)
- name: Validate environment variables
  run: pnpm validate:env
  env:
    NODE_ENV: production
    DATABASE_URL: postgresql://user:password@localhost:5432/atlas_ci
    NEXT_PUBLIC_API_URL: https://api.example.com
```

See [Continuous Integration](ci.md) for the full pipeline layout and testing instructions.

**GitHub Configuration:**

- Secrets (`secrets.*`): Server-only sensitive values
- Variables (`vars.*`): Public configuration values

## Troubleshooting

| Problem              | Solution                                           |
| -------------------- | -------------------------------------------------- |
| "Required" error     | Variable not set in environment                    |
| "Invalid url" error  | Value doesn't match URL format                     |
| Type error in IDE    | Restart TypeScript server                          |
| Old values persist   | Restart dev server after `.env.local` changes      |
| Client var undefined | Missing `NEXT_PUBLIC_` prefix, or restart required |

## Related

- [ADR: Env Validation with t3-env](../adr/0002-env-validation-t3-env.md)
- [T3 Env Documentation](https://env.t3.gg/)
