import { cn } from "./utils";

/**
 * Shared geometry and interaction classes for Atlas form controls.
 * Components reference semantic tokens — not arbitrary color values.
 */
export const controlGeometryClasses =
  "h-9 w-full min-w-0 rounded-control px-2.5 text-sm md:text-sm";

/**
 * Surface transitions only — exclude box-shadow so Tailwind focus/invalid rings snap on/off
 * instead of fading during blur (rings are implemented as box-shadow).
 */
export const controlSurfaceTransitionClasses = "transition-[color,background-color,border-color]";

export const controlSurfaceClasses =
  "border border-control-border bg-control-background text-control-foreground shadow-control outline-none hover:border-control-border-hover hover:bg-control-background-hover";

export const controlSurfaceWithTransitionClasses = cn(
  controlSurfaceClasses,
  controlSurfaceTransitionClasses
);

/** Matches shadcn base-vega focus wiring (`--ring` via border-ring + ring-ring/50). */
export const controlFocusClasses =
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const controlInvalidClasses =
  "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/30";

export const controlDisabledClasses =
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export const controlPlaceholderClasses = "placeholder:text-control-foreground-muted";

/** Composed base for text-entry controls (Input, Textarea, Select trigger). */
export function controlClasses(...extra: (string | undefined | false)[]) {
  return cn(
    controlGeometryClasses,
    controlSurfaceWithTransitionClasses,
    controlFocusClasses,
    controlInvalidClasses,
    controlDisabledClasses,
    controlPlaceholderClasses,
    ...extra
  );
}

/** Shared focus ring treatment for interactive controls (Button, Checkbox, Switch). */
export const interactiveFocusClasses =
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

/** Shared invalid-state treatment for interactive controls. */
export const interactiveInvalidClasses =
  "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/30";

/** Shared disabled treatment for interactive controls. */
export const interactiveDisabledClasses =
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";
