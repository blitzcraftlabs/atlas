import { z } from "zod";

import { ServerEnvSchema } from "./server-runtime-config";

/**
 * Server schema with production-only requirements.
 *
 * DATABASE_URL is optional for local frontend/demo development but required
 * when NODE_ENV is production (CI and deployment).
 */
export function getServerEnvSchema(nodeEnv: string) {
  const referenceModeGuard = z
    .string()
    .optional()
    .refine((val) => val !== "true", {
      message: "ATLAS_REFERENCE_MODE cannot be enabled in production",
    });

  if (nodeEnv === "production") {
    return z.object({
      ...ServerEnvSchema,
      DATABASE_URL: z.string().url(),
      ATLAS_REFERENCE_MODE: referenceModeGuard,
    });
  }

  return z.object(ServerEnvSchema);
}
