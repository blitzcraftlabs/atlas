/**
 * Canonical Atlas architecture policy metadata.
 *
 * Consumed by apps/web/eslint.config.mjs and Atlas Doctor (via message tagging) so ESLint
 * enforcement and Doctor diagnostics stay aligned without duplicating policy identity.
 */

/** @typedef {"ATLAS_BOUNDARY_PRIVATE_IMPORT" | "ATLAS_BOUNDARY_DIRECT_ENV" | "ATLAS_BOUNDARY_RAW_NETWORK" | "ATLAS_BOUNDARY_REFERENCE_IMPORT" | "ATLAS_BOUNDARY_CROSS_FEATURE_IMPORT" | "ATLAS_BOUNDARY_ANALYTICS_VENDOR"} AtlasBoundaryDiagnosticCode */

/** @type {Record<AtlasBoundaryDiagnosticCode, { documentation: string; suggestedFix: string }>} */
export const BOUNDARY_DIAGNOSTIC_METADATA = {
  ATLAS_BOUNDARY_PRIVATE_IMPORT: {
    documentation: "docs/how-we-build/architecture-ownership.md",
    suggestedFix:
      "Import from the package public entry point (for example `@atlas/ui`) instead of workspace source paths or UI-internal app aliases.",
  },
  ATLAS_BOUNDARY_DIRECT_ENV: {
    documentation: "docs/how-we-build/architecture-ownership.md",
    suggestedFix:
      "Use `getServerConfig()` on the server or `useConfig()` on the client instead of direct `process.env` or `@/env` imports.",
  },
  ATLAS_BOUNDARY_RAW_NETWORK: {
    documentation: "docs/how-we-build/api.md",
    suggestedFix:
      "Use the central API client from `@/lib/api` instead of raw `fetch()` in application-layer code.",
  },
  ATLAS_BOUNDARY_REFERENCE_IMPORT: {
    documentation: "docs/how-we-build/architecture-ownership.md",
    suggestedFix:
      "Do not import reference or example modules from product features. Copy the pattern or extract shared logic to `src/lib/`.",
  },
  ATLAS_BOUNDARY_CROSS_FEATURE_IMPORT: {
    documentation: "docs/how-we-build/architecture-ownership.md",
    suggestedFix:
      "Do not import one product feature from another. Extract shared logic to `src/lib/` and import from there.",
  },
  ATLAS_BOUNDARY_ANALYTICS_VENDOR: {
    documentation: "docs/how-we-build/architecture-ownership.md",
    suggestedFix:
      "Use the analytics adapter from `@/lib/analytics` instead of importing analytics vendor SDKs directly.",
  },
};

const DOCTOR_TAG_PREFIX = "@atlas-doctor:";

/**
 * @param {AtlasBoundaryDiagnosticCode} code
 * @param {string} message
 */
export function doctorTaggedMessage(code, message) {
  return `${message}\n${DOCTOR_TAG_PREFIX}${code}`;
}

/**
 * @param {string} message
 * @returns {AtlasBoundaryDiagnosticCode | undefined}
 */
export function parseDoctorTagFromMessage(message) {
  const lines = message.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith(DOCTOR_TAG_PREFIX)) {
      return /** @type {AtlasBoundaryDiagnosticCode} */ (line.slice(DOCTOR_TAG_PREFIX.length));
    }
  }

  return undefined;
}

export const PROCESS_ENV_MESSAGE = doctorTaggedMessage(
  "ATLAS_BOUNDARY_DIRECT_ENV",
  "Direct access to process.env is not allowed. Use the config facade instead:\n" +
    "  - Server-side: import { getServerConfig } from '@/config'\n" +
    "  - Client-side: import { useConfig } from '@/config'\n" +
    "This ensures type safety, validation, and consistent config access patterns."
);

export const PROCESS_ENV_SELECTOR = "MemberExpression[object.name='process'][property.name='env']";

export const FETCH_MESSAGE = doctorTaggedMessage(
  "ATLAS_BOUNDARY_RAW_NETWORK",
  "Direct fetch() calls are not allowed. Use the central API client from @/lib/api instead. " +
    "This ensures consistent error handling, correlation ID propagation, and retry logic."
);

export const POSTHOG_IMPORT_PATHS = [
  {
    name: "posthog-js",
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_ANALYTICS_VENDOR",
      "Direct PostHog imports are not allowed. Use the analytics adapter instead:\n" +
        "  import { analytics } from '@/lib/analytics';\n" +
        "This ensures consistent event tracking and consent management."
    ),
  },
  {
    name: "posthog-js/react",
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_ANALYTICS_VENDOR",
      "Direct PostHog imports are not allowed. Use the analytics adapter instead:\n" +
        "  import { analytics } from '@/lib/analytics';\n" +
        "This ensures consistent event tracking and consent management."
    ),
  },
];

export const ENV_IMPORT_PATTERNS = [
  {
    group: ["@/env", "@/env/*"],
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_DIRECT_ENV",
      "Direct env imports are discouraged. Use the config facade instead:\n" +
        "  - Server-side: import { getServerConfig } from '@/config'\n" +
        "  - Client-side: import { useConfig } from '@/config'\n" +
        "This provides a stable, typed config interface and separates concerns."
    ),
  },
];

export const UI_INTERNAL_ALIAS_PATTERNS = [
  {
    group: ["@/lib/utils", "@/lib/utils/*", "@/hooks/use-zod-form", "@/hooks/use-theme"],
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_PRIVATE_IMPORT",
      "Do not import @atlas/ui internals via app aliases. Use the public API:\n" +
        "  import { cn, useZodForm, useTheme } from '@atlas/ui';"
    ),
  },
];

export const PACKAGE_SOURCE_PATTERNS = [
  {
    group: ["**/packages/ui/**", "**/packages/consent/**", "../../packages/**"],
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_PRIVATE_IMPORT",
      "Do not import workspace package source directly. Use public package exports:\n" +
        "  import { Button } from '@atlas/ui';\n" +
        "  import '@atlas/ui/globals.css';"
    ),
  },
];

export const REFERENCE_IMPORT_PATTERNS = [
  {
    group: [
      "@/features/reference/**",
      "@/features/examples/**",
      "**/features/reference/**",
      "**/features/examples/**",
    ],
    message: doctorTaggedMessage(
      "ATLAS_BOUNDARY_REFERENCE_IMPORT",
      "Product features must not import reference or example modules. Copy the pattern or extract shared logic to src/lib/."
    ),
  },
];

/** Standard app import policy: env facade, analytics adapters, UI public API, package source. */
export const STANDARD_APP_IMPORT_RESTRICTIONS = {
  paths: POSTHOG_IMPORT_PATHS,
  patterns: [...ENV_IMPORT_PATTERNS, ...UI_INTERNAL_ALIAS_PATTERNS, ...PACKAGE_SOURCE_PATTERNS],
};

/** API route import policy: same boundaries except direct @/env imports (route handlers may read env). */
export const API_ROUTE_IMPORT_RESTRICTIONS = {
  paths: POSTHOG_IMPORT_PATHS,
  patterns: [...UI_INTERNAL_ALIAS_PATTERNS, ...PACKAGE_SOURCE_PATTERNS],
};

/** lib/providers import policy: no analytics vendor ban (adapters live in lib). */
export const LIB_PROVIDER_IMPORT_RESTRICTIONS = {
  patterns: [...ENV_IMPORT_PATTERNS, ...UI_INTERNAL_ALIAS_PATTERNS, ...PACKAGE_SOURCE_PATTERNS],
};

/** Config/env implementation: package boundaries without @/env self-import ban. */
export const CONFIG_IMPORT_RESTRICTIONS = {
  patterns: [...UI_INTERNAL_ALIAS_PATTERNS, ...PACKAGE_SOURCE_PATTERNS],
};

/** Product feature ownership import policy — standard app boundaries plus reference ownership. */
export const PRODUCT_FEATURE_IMPORT_RESTRICTIONS = {
  paths: POSTHOG_IMPORT_PATHS,
  patterns: [
    ...ENV_IMPORT_PATTERNS,
    ...UI_INTERNAL_ALIAS_PATTERNS,
    ...PACKAGE_SOURCE_PATTERNS,
    ...REFERENCE_IMPORT_PATTERNS,
  ],
};

/** Shared test file ignores for architecture boundary rules. */
export const TEST_FILE_IGNORES = [
  "src/test/**",
  "**/__tests__/**",
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
];

export function processEnvSyntaxRule() {
  return {
    selector: PROCESS_ENV_SELECTOR,
    message: PROCESS_ENV_MESSAGE,
  };
}

export function fetchCallSyntaxRule() {
  return {
    selector: "CallExpression[callee.name='fetch']",
    message: FETCH_MESSAGE,
  };
}

export function fetchGlobalRestriction() {
  return {
    name: "fetch",
    message: FETCH_MESSAGE,
  };
}

/** Standard product-feature syntax policy — process.env and raw fetch both banned. */
export function productFeatureSyntaxRules() {
  return {
    "no-restricted-syntax": ["error", processEnvSyntaxRule(), fetchCallSyntaxRule()],
    "no-restricted-globals": ["error", fetchGlobalRestriction()],
  };
}

export function fetchSyntaxRules() {
  return {
    "no-restricted-syntax": ["error", fetchCallSyntaxRule()],
    "no-restricted-globals": ["error", fetchGlobalRestriction()],
  };
}

/**
 * ESLint flat-config override for a custom product feature root under application src.
 *
 * @param {object} options
 * @param {string} options.relativeFromApplication
 * @param {string | undefined} options.referenceIgnoreGlob
 * @param {string | undefined} options.examplesIgnoreGlob
 * @param {unknown} options.productRestrictions
 */
export function buildCustomProductFeatureEslintOverride(options) {
  const {
    relativeFromApplication,
    referenceIgnoreGlob,
    examplesIgnoreGlob,
    productRestrictions,
  } = options;

  const ignores = [
    ...(referenceIgnoreGlob ? [referenceIgnoreGlob] : []),
    ...(examplesIgnoreGlob ? [examplesIgnoreGlob] : []),
    ...TEST_FILE_IGNORES,
  ];

  return {
    files: [`${relativeFromApplication}/**/*.{ts,tsx}`],
    ignores,
    rules: {
      "no-restricted-imports": ["error", productRestrictions],
      ...productFeatureSyntaxRules(),
    },
  };
}
