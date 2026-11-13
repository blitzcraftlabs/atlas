/**
 * Permission denied presentation state.
 *
 * Distinguishes authenticated-but-forbidden from generic errors.
 * Reuses ErrorFallback — not a new primitive.
 */

import { ErrorFallback } from "@atlas/ui";

export interface PermissionDeniedProps {
  title?: string;
  description?: string;
  correlationId?: string;
}

export function PermissionDenied({
  title = "Permission denied",
  description = "You don't have permission to access this resource.",
  correlationId,
}: PermissionDeniedProps) {
  return <ErrorFallback title={title} description={description} correlationId={correlationId} />;
}
