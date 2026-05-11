import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
import CheckboxItem from "./dropdown-menu-checkbox-item.svelte";
import Content from "./dropdown-menu-content.svelte";
import Item from "./dropdown-menu-item.svelte";
import Label from "./dropdown-menu-label.svelte";
import RadioGroup from "./dropdown-menu-radio-group.svelte";
import RadioItem from "./dropdown-menu-radio-item.svelte";
import Separator from "./dropdown-menu-separator.svelte";
import Shortcut from "./dropdown-menu-shortcut.svelte";
import SubContent from "./dropdown-menu-sub-content.svelte";
import SubTrigger from "./dropdown-menu-sub-trigger.svelte";

const Sub = DropdownMenuPrimitive.Sub;
const Root = DropdownMenuPrimitive.Root;
const Trigger = DropdownMenuPrimitive.Trigger;
const Group = DropdownMenuPrimitive.Group;

export {
  CheckboxItem,
  Content,
  //
  Root as DropdownMenu,
  CheckboxItem as DropdownMenuCheckboxItem,
  Content as DropdownMenuContent,
  Group as DropdownMenuGroup,
  Item as DropdownMenuItem,
  Label as DropdownMenuLabel,
  RadioGroup as DropdownMenuRadioGroup,
  RadioItem as DropdownMenuRadioItem,
  Separator as DropdownMenuSeparator,
  Shortcut as DropdownMenuShortcut,
  Sub as DropdownMenuSub,
  SubContent as DropdownMenuSubContent,
  SubTrigger as DropdownMenuSubTrigger,
  Trigger as DropdownMenuTrigger,
  Group,
  Item,
  Label,
  RadioGroup,
  RadioItem,
  Root,
  Separator,
  Shortcut,
  Sub,
  SubContent,
  SubTrigger,
  Trigger,
};
