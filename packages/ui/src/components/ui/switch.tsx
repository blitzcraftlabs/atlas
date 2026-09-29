"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import {
  controlSurfaceTransitionClasses,
  interactiveFocusClasses,
  interactiveInvalidClasses,
} from "../../lib/control-styles";
import { cn } from "../../lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch shadow-control data-checked:bg-switch-track-checked data-unchecked:border-control-border data-unchecked:bg-switch-track relative inline-flex shrink-0 items-center rounded-full border border-transparent group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px]",
        controlSurfaceTransitionClasses,
        interactiveFocusClasses,
        interactiveInvalidClasses,
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="border-switch-thumb-border bg-switch-thumb shadow-control dark:data-checked:bg-control-primary-foreground pointer-events-none block rounded-full border ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
