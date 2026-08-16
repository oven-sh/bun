import type { Button as ButtonPrimitive } from "bits-ui";
import { tv, type VariantProps } from "tailwind-variants";
import Root from "./button.svelte";

const buttonVariants = tv({
  base: "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/90",
      "primary-outline":
        "border border-primary/50 bg-transparent text-foreground hover:bg-primary/20",
      destructive:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      indigo: "bg-indigo-700 text-foreground hover:bg-indigo-700/90",
      "indigo-outline":
        "border border-indigo-700/50 bg-transparent text-foreground hover:bg-indigo-700/20",
      sky: "bg-sky-700 text-foreground hover:bg-sky-700/90",
      "sky-outline":
        "border border-sky-700/50 bg-transparent text-foreground hover:bg-sky-700/20",
      "blue-outline":
        "border border-blue-700/50 bg-transparent text-foreground hover:bg-blue-700/20",
      "green-outline":
        "border border-green-700/50 bg-transparent text-foreground hover:bg-green-700/20",
      outline:
        "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      ghost:
        "hover:bg-accent/90 active:bg-accent hover:text-accent-foreground/90 active:text-accent-foreground focus-visible:bg-accent",
      link: "text-foreground underline-offset-4 hover:underline",
    },
    size: {
      default: "h-10 px-4 py-2",
      sm: "h-9 rounded-md px-3",
      lg: "h-11 rounded-md px-8",
      icon: "h-10 w-10",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type Variant = VariantProps<typeof buttonVariants>["variant"];
type Size = VariantProps<typeof buttonVariants>["size"];

type Props = ButtonPrimitive.Props & {
  variant?: Variant;
  size?: Size;
};

type Events = ButtonPrimitive.Events;

export {
  //
  Root as Button,
  buttonVariants,
  Root,
  type Events as ButtonEvents,
  type Props as ButtonProps,
  type Events,
  type Props,
};
