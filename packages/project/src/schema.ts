import { z } from "zod";

import { LATEST_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from "./constants";
import {
  AtlasContractError,
  AtlasContractErrorCode,
  formatUnsupportedSchemaVersion,
  formatValidationErrors,
} from "./errors";

const repoRelativePath = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\\"), "Path must use forward slashes")
  .refine((value) => !pathLooksAbsolute(value), "Path must be repository-relative")
  .refine((value) => !value.split("/").includes(".."), "Path must not contain parent segments");

function pathLooksAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:/.test(value);
}

const applicationSchema = z
  .object({
    root: repoRelativePath,
  })
  .strict();

const featuresSchema = z
  .object({
    product: repoRelativePath,
    reference: repoRelativePath,
    examples: repoRelativePath,
  })
  .strict();

const referenceSchema = z
  .object({
    components: repoRelativePath,
    routes: repoRelativePath,
  })
  .strict();

const uiSchema = z
  .object({
    package: z.string().min(1),
    path: repoRelativePath,
    sourceImports: z.boolean(),
  })
  .strict();

const openApiGeneratedSchema = z
  .object({
    spec: repoRelativePath,
    schema: repoRelativePath,
  })
  .strict();

const generatedSchema = z
  .object({
    openApi: openApiGeneratedSchema,
  })
  .strict();

const capabilitiesSchema = z
  .object({
    auth: z.boolean(),
    consent: z.boolean(),
    analytics: z.boolean(),
    featureFlags: z.boolean(),
    i18n: z.boolean(),
    openApi: z.boolean(),
    observability: z.boolean(),
  })
  .strict();

const boundariesSchema = z
  .object({
    noFeatureToFeatureImports: z.boolean(),
    noProductImportsFromReference: z.boolean(),
    uiPublicApiOnly: z.boolean(),
  })
  .strict();

const baselineChecksumValueSchema = z
  .string()
  .refine(
    (value) => /^sha256:[a-fA-F0-9]{64}$/.test(value),
    "Checksum must match sha256:<64 hexadecimal characters>"
  )
  .transform((value) => `sha256:${value.slice("sha256:".length).toLowerCase()}`);

const platformBaselineSchema = z
  .object({
    atlasVersion: z.string().min(1),
    contractSchemaVersion: z.number().int().positive(),
    templateManifestSchemaVersion: z.number().int().positive(),
    syncedPathChecksums: z.record(z.string().min(1), baselineChecksumValueSchema),
    repositorySyncedPathChecksums: z
      .record(z.string().min(1), baselineChecksumValueSchema)
      .optional(),
  })
  .strict();

/** Built-in generator ids that custom generators may not reuse. */
export const RESERVED_GENERATOR_IDS = ["feature", "page", "list"] as const;

const generatorIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "Generator id must be kebab-case")
  .refine(
    (value) => !(RESERVED_GENERATOR_IDS as readonly string[]).includes(value),
    "Generator id is reserved by a built-in Atlas generator"
  );

/**
 * A consumer-defined generator. Every file under `templates` is rendered into `target`.
 * Paths and contents may use {{name}}, {{kebab}}, {{camel}}, {{pascal}} and {{title}}.
 * A trailing `.tmpl` suffix is stripped from file names.
 */
const customGeneratorSchema = z
  .object({
    description: z.string().min(1),
    templates: repoRelativePath,
    target: repoRelativePath,
    argument: z
      .object({
        name: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/),
        description: z.string().min(1),
      })
      .strict()
      .optional(),
    followUp: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CustomGeneratorDefinition = z.infer<typeof customGeneratorSchema>;

const generatorsSchema = z.record(generatorIdSchema, customGeneratorSchema);

const platformSchema = z
  .object({
    baseline: platformBaselineSchema,
  })
  .strict();

export const atlasProjectContractSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    application: applicationSchema.partial().optional(),
    features: featuresSchema.partial().optional(),
    reference: referenceSchema.partial().optional(),
    ui: uiSchema.partial().optional(),
    generated: z
      .object({
        openApi: openApiGeneratedSchema.partial(),
      })
      .strict()
      .optional(),
    capabilities: capabilitiesSchema.partial().optional(),
    boundaries: boundariesSchema.partial().optional(),
    generators: generatorsSchema.optional(),
    platform: platformSchema.optional(),
  })
  .strict();

export type PlatformBaseline = z.infer<typeof platformBaselineSchema>;

export type RawAtlasProjectContract = z.infer<typeof atlasProjectContractSchema>;

export const resolvedApplicationSchema = applicationSchema;
export const resolvedFeaturesSchema = featuresSchema;
export const resolvedReferenceSchema = referenceSchema;
export const resolvedUiSchema = uiSchema;
export const resolvedGeneratedSchema = generatedSchema;
export const resolvedCapabilitiesSchema = capabilitiesSchema;
export const resolvedBoundariesSchema = boundariesSchema;
export const resolvedPlatformBaselineSchema = platformBaselineSchema;
export const resolvedPlatformSchema = platformSchema;

export const resolvedAtlasProjectSchema = z
  .object({
    schemaVersion: z.literal(LATEST_SCHEMA_VERSION),
    application: resolvedApplicationSchema,
    features: resolvedFeaturesSchema,
    reference: resolvedReferenceSchema,
    ui: resolvedUiSchema,
    generated: resolvedGeneratedSchema,
    capabilities: resolvedCapabilitiesSchema,
    boundaries: resolvedBoundariesSchema,
    generators: generatorsSchema.optional(),
    platform: resolvedPlatformSchema.optional(),
  })
  .strict();

export type ResolvedAtlasProject = z.infer<typeof resolvedAtlasProjectSchema>;

export function parseAtlasProjectContract(raw: unknown): RawAtlasProjectContract {
  const result = atlasProjectContractSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${pathLabel}: ${issue.message}`;
    });

    throw new AtlasContractError(
      AtlasContractErrorCode.CONTRACT_VALIDATION_FAILED,
      formatValidationErrors(errors),
      errors
    );
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(result.data.schemaVersion as 1)) {
    throw new AtlasContractError(
      AtlasContractErrorCode.CONTRACT_UNSUPPORTED_VERSION,
      formatUnsupportedSchemaVersion(result.data.schemaVersion)
    );
  }

  return result.data;
}
