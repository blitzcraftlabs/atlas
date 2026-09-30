"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import {
  controlSurfaceTransitionClasses,
  interactiveDisabledClasses,
  interactiveFocusClasses,
  interactiveInvalidClasses,
} from "../../lib/control-styles";
import { cn } from "../../lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-control-border bg-control-background shadow-control group-has-[:focus-visible]/field-label:not-data-checked:border-control-border group-has-[:focus-visible]/field-label:data-checked:border-control-primary-border data-checked:border-control-primary-border data-checked:bg-control-primary-background data-checked:text-control-primary-foreground relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2",
        controlSurfaceTransitionClasses,
        interactiveFocusClasses,
        interactiveDisabledClasses,
        interactiveInvalidClasses,
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
