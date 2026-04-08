import { type VariantProps, tv } from "tailwind-variants";

import Description from "./alert-description.svelte";
import Title from "./alert-title.svelte";
import Root from "./alert.svelte";

export const alertVariants = tv({
  base: "[&>svg]:text-foreground relative w-full rounded-lg border p-4 [&:has(svg)]:pl-11 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4",

  variants: {
    variant: {
      default: "bg-background text-foreground",
      destructive:
        "border-destructive/50 text-destructive text-destructive dark:border-destructive [&>svg]:text-destructive",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type Variant = VariantProps<typeof alertVariants>["variant"];
export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export {
  //
  Root as Alert,
  Description as AlertDescription,
  Title as AlertTitle,
  Description,
  Root,
  Title,
};
