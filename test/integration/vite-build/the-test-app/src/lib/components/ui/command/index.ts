import { Command as CommandPrimitive } from "cmdk-sv";

import Dialog from "./command-dialog.svelte";
import Empty from "./command-empty.svelte";
import Group from "./command-group.svelte";
import Input from "./command-input.svelte";
import Item from "./command-item.svelte";
import List from "./command-list.svelte";
import Separator from "./command-separator.svelte";
import Shortcut from "./command-shortcut.svelte";
import Root from "./command.svelte";

const Loading = CommandPrimitive.Loading;

export {
  //
  Root as Command,
  Dialog as CommandDialog,
  Empty as CommandEmpty,
  Group as CommandGroup,
  Input as CommandInput,
  Item as CommandItem,
  List as CommandList,
  Loading as CommandLoading,
  Separator as CommandSeparator,
  Shortcut as CommandShortcut,
  Dialog,
  Empty,
  Group,
  Input,
  Item,
  List,
  Loading,
  Root,
  Separator,
  Shortcut,
};
