import { RadioGroup as RadioGroupPrimitive } from "bits-ui";

import Item from "./radio-group-item.svelte";
import Root from "./radio-group.svelte";
const Input = RadioGroupPrimitive.Input;

export {
  Input,
  Item,
  //
  Root as RadioGroup,
  Input as RadioGroupInput,
  Item as RadioGroupItem,
  Root,
};
