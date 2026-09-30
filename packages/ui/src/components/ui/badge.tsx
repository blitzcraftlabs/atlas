import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { controlSurfaceTransitionClasses, interactiveFocusClasses } from "../../lib/control-styles";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  cn(
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-control border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
    controlSurfaceTransitionClasses,
    interactiveFocusClasses,
    "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/30"
  ),
  {
    variants: {
      variant: {
        default:
          "bg-control-primary-background text-control-primary-foreground [a]:hover:bg-control-primary-background-hover",
        secondary:
          "border-control-border bg-control-background text-control-foreground [a]:hover:bg-control-background-hover",
        destructive:
          "border-control-destructive-border bg-control-destructive-background text-control-destructive-foreground [a]:hover:bg-control-destructive-background-hover",
        outline:
          "border-control-border text-control-foreground [a]:hover:bg-control-background-hover",
        ghost: "text-control-foreground [a]:hover:bg-control-background-hover",
        link: "text-primary underline-offset-4 [a]:hover:underline",
        success:
          "border-transparent bg-success-subtle text-success-foreground [a]:hover:opacity-90",
        warning:
          "border-transparent bg-warning-subtle text-warning-foreground [a]:hover:opacity-90",
        info: "border-transparent bg-info-subtle text-info-foreground [a]:hover:opacity-90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
