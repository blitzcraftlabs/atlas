import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import {
  controlSurfaceTransitionClasses,
  interactiveDisabledClasses,
  interactiveFocusClasses,
  interactiveInvalidClasses,
} from "../../lib/control-styles";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  cn(
    "group/button inline-flex shrink-0 items-center justify-center rounded-control bg-clip-padding text-sm font-medium whitespace-nowrap shadow-control select-none active:not-aria-[haspopup]:translate-y-px",
    controlSurfaceTransitionClasses,
    interactiveFocusClasses,
    interactiveDisabledClasses,
    interactiveInvalidClasses,
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  ),
  {
    variants: {
      variant: {
        default:
          "border border-control-primary-border bg-control-primary-background text-control-primary-foreground hover:bg-control-primary-background-hover active:bg-control-primary-background-active",
        secondary:
          "border border-control-secondary-border bg-control-secondary-background text-control-foreground hover:border-control-secondary-border hover:bg-control-secondary-background-hover active:bg-control-secondary-background-active aria-expanded:bg-control-secondary-background-hover",
        outline:
          "border border-control-border bg-control-outline-background text-control-foreground shadow-none hover:border-control-border-hover hover:bg-control-outline-background-hover active:bg-control-outline-background-active aria-expanded:bg-control-outline-background-hover",
        ghost:
          "border border-transparent text-control-foreground shadow-none hover:bg-control-background-hover active:bg-control-background-active aria-expanded:bg-control-background-hover",
        destructive:
          "border border-control-destructive-border bg-control-destructive-background text-control-destructive-foreground hover:border-control-destructive-border hover:bg-control-destructive-background-hover active:bg-control-destructive-background-active focus-visible:border-destructive focus-visible:ring-destructive/25",
        link: "border-transparent text-primary shadow-none underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
