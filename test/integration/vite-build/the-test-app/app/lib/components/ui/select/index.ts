import { Select as SelectPrimitive } from "bits-ui";
import Content from "./select-content.svelte";
import Item from "./select-item.svelte";
import Label from "./select-label.svelte";
import Separator from "./select-separator.svelte";
import Trigger from "./select-trigger.svelte";

const Root = SelectPrimitive.Root;
const Group = SelectPrimitive.Group;
const Input = SelectPrimitive.Input;
const Value = SelectPrimitive.Value;

export {
  Content,
  Group,
  Input,
  Item,
  Label,
  Root,
  //
  Root as Select,
  Content as SelectContent,
  Group as SelectGroup,
  Input as SelectInput,
  Item as SelectItem,
  Label as SelectLabel,
  Separator as SelectSeparator,
  Trigger as SelectTrigger,
  Value as SelectValue,
  Separator,
  Trigger,
  Value,
};
