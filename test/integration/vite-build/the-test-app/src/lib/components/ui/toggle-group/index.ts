import type { toggleVariants } from "$lib/components/ui/toggle/index";
import { getContext, setContext } from "svelte";
import type { VariantProps } from "tailwind-variants";
import Item from "./toggle-group-item.svelte";
import Root from "./toggle-group.svelte";

export type ToggleVariants = VariantProps<typeof toggleVariants>;

export function setToggleGroupCtx(props: ToggleVariants) {
  setContext("toggleGroup", props);
}

export function getToggleGroupCtx() {
  return getContext<ToggleVariants>("toggleGroup");
}

export {
  Item,
  Root,
  //
  Root as ToggleGroup,
  Item as ToggleGroupItem,
};
