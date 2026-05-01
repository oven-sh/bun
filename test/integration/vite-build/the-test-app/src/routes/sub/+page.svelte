<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Calendar } from "$lib/components/ui/calendar/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { getLocalTimeZone, today } from "@internationalized/date";
  import Calculator from "lucide-svelte/icons/calculator";
  import CirclePlus from "lucide-svelte/icons/circle-plus";
  import Cloud from "lucide-svelte/icons/cloud";
  import CreditCard from "lucide-svelte/icons/credit-card";
  import Github from "lucide-svelte/icons/github";
  import Keyboard from "lucide-svelte/icons/keyboard";
  import LifeBuoy from "lucide-svelte/icons/life-buoy";
  import LogOut from "lucide-svelte/icons/log-out";
  import Mail from "lucide-svelte/icons/mail";
  import MessageSquare from "lucide-svelte/icons/message-square";
  import Plus from "lucide-svelte/icons/plus";
  import Settings from "lucide-svelte/icons/settings";
  import Smile from "lucide-svelte/icons/smile";
  import User from "lucide-svelte/icons/user";
  import UserPlus from "lucide-svelte/icons/user-plus";
  import Users from "lucide-svelte/icons/users";
  import CalendarDays from "lucide-svelte/icons/calendar-days";
  import * as HoverCard from "$lib/components/ui/hover-card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import ChevronLeft from "lucide-svelte/icons/chevron-left";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import * as Pagination from "$lib/components/ui/pagination/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import * as RadioGroup from "$lib/components/ui/radio-group/index.js";
  import { Toggle } from "$lib/components/ui/toggle/index.js";
  import Bold from "lucide-svelte/icons/bold";
  import Italic from "lucide-svelte/icons/italic";
  import Underline from "lucide-svelte/icons/underline";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";

  let value = today(getLocalTimeZone());
  let checked = false;

  let count = 20;
  $: perPage = 3;
  $: siblingCount = 1;
</script>

<div class="flex flex-col gap-4">
  <Toggle aria-label="toggle bold">
    <Bold class="h-4 w-4" />
  </Toggle>

  <ToggleGroup.Root type="multiple">
    <ToggleGroup.Item value="bold" aria-label="Toggle bold">
      <Bold class="h-4 w-4" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="italic" aria-label="Toggle italic">
      <Italic class="h-4 w-4" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="strikethrough" aria-label="Toggle strikethrough">
      <Underline class="h-4 w-4" />
    </ToggleGroup.Item>
  </ToggleGroup.Root>

  <h1>Hello world</h1>

  <Button>Button</Button>

  <RadioGroup.Root value="comfortable">
    <div class="flex items-center space-x-2">
      <RadioGroup.Item value="default" id="r1" />
      <Label for="r1">Default</Label>
    </div>
    <div class="flex items-center space-x-2">
      <RadioGroup.Item value="comfortable" id="r2" />
      <Label for="r2">Comfortable</Label>
    </div>
    <div class="flex items-center space-x-2">
      <RadioGroup.Item value="compact" id="r3" />
      <Label for="r3">Compact</Label>
    </div>
    <RadioGroup.Input name="spacing" />
  </RadioGroup.Root>

  <Button variant="secondary">Button</Button>
  <Button variant="destructive">Button</Button>
  <Button variant="green-outline">Button</Button>
  <Button variant="indigo-outline">Button</Button>
  <Button variant="primary-outline">Button</Button>

  <Calendar bind:value class="rounded-md border" />

  <Progress {value} max={100} class="w-[60%]" />

  <div class="flex items-center space-x-2">
    <Checkbox id="terms" bind:checked aria-labelledby="terms-label" />
    <Label
      id="terms-label"
      for="terms"
      class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
    >
      Accept terms and conditions
    </Label>
  </div>

  <Command.Root class="max-w-[450px] rounded-lg border shadow-md">
    <Command.Input placeholder="Type a command or search..." />
    <Command.List>
      <Command.Empty>No results found.</Command.Empty>
      <Command.Group heading="Suggestions">
        <Command.Item>
          <Smile class="mr-2 h-4 w-4" />
          <span>Search Emoji</span>
        </Command.Item>
        <Command.Item>
          <Calculator class="mr-2 h-4 w-4" />
          <span>Calculator</span>
        </Command.Item>
      </Command.Group>
      <Command.Separator />
      <Command.Group heading="Settings">
        <Command.Item>
          <User class="mr-2 h-4 w-4" />
          <span>Profile</span>
          <Command.Shortcut>⌘P</Command.Shortcut>
        </Command.Item>
        <Command.Item>
          <CreditCard class="mr-2 h-4 w-4" />
          <span>Billing</span>
          <Command.Shortcut>⌘B</Command.Shortcut>
        </Command.Item>
        <Command.Item>
          <Settings class="mr-2 h-4 w-4" />
          <span>Settings</span>
          <Command.Shortcut>⌘S</Command.Shortcut>
        </Command.Item>
      </Command.Group>
    </Command.List>
  </Command.Root>
</div>

<DropdownMenu.Root>
  <DropdownMenu.Trigger asChild let:builder>
    <Button builders={[builder]} variant="outline">Open</Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-56">
    <DropdownMenu.Label>My Account</DropdownMenu.Label>
    <DropdownMenu.Separator />
    <DropdownMenu.Group>
      <DropdownMenu.Item>
        <User class="mr-2 h-4 w-4" />
        <span>Profile</span>
        <DropdownMenu.Shortcut>⇧⌘P</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
      <DropdownMenu.Item>
        <CreditCard class="mr-2 h-4 w-4" />
        <span>Billing</span>
        <DropdownMenu.Shortcut>⌘B</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
      <DropdownMenu.Item>
        <Settings class="mr-2 h-4 w-4" />
        <span>Settings</span>
        <DropdownMenu.Shortcut>⌘S</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
      <DropdownMenu.Item>
        <Keyboard class="mr-2 h-4 w-4" />
        <span>Keyboard shortcuts</span>
        <DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
    </DropdownMenu.Group>
    <DropdownMenu.Separator />
    <DropdownMenu.Group>
      <DropdownMenu.Item>
        <Users class="mr-2 h-4 w-4" />
        <span>Team</span>
      </DropdownMenu.Item>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>
          <UserPlus class="mr-2 h-4 w-4" />
          <span>Invite users</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent>
          <DropdownMenu.Item>
            <Mail class="mr-2 h-4 w-4" />
            <span>Email</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item>
            <MessageSquare class="mr-2 h-4 w-4" />
            <span>Message</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item>
            <CirclePlus class="mr-2 h-4 w-4" />
            <span>More...</span>
          </DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
      <DropdownMenu.Item>
        <Plus class="mr-2 h-4 w-4" />
        <span>New Team</span>
        <DropdownMenu.Shortcut>⌘+T</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
    </DropdownMenu.Group>
    <DropdownMenu.Separator />
    <DropdownMenu.Item>
      <Github class="mr-2 h-4 w-4" />
      <span>GitHub</span>
    </DropdownMenu.Item>
    <DropdownMenu.Item>
      <LifeBuoy class="mr-2 h-4 w-4" />
      <span>Support</span>
    </DropdownMenu.Item>
    <DropdownMenu.Item>
      <Cloud class="mr-2 h-4 w-4" />
      <span>API</span>
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item>
      <LogOut class="mr-2 h-4 w-4" />
      <span>Log out</span>
      <DropdownMenu.Shortcut>⇧⌘Q</DropdownMenu.Shortcut>
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<HoverCard.Root>
  <HoverCard.Trigger
    href="https://github.com/sveltejs"
    target="_blank"
    rel="noreferrer noopener"
    class="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-black"
  >
    @sveltejs
  </HoverCard.Trigger>
  <HoverCard.Content class="w-80">
    <div class="flex justify-between space-x-4">
      <div class="space-y-1">
        <h4 class="text-sm font-semibold">@sveltejs</h4>
        <p class="text-sm">Cybernetically enhanced web apps.</p>
        <div class="flex items-center pt-2">
          <CalendarDays class="mr-2 h-4 w-4 opacity-70" />
          <span class="text-muted-foreground text-xs">
            Joined September 2022
          </span>
        </div>
      </div>
    </div>
  </HoverCard.Content>
</HoverCard.Root>

<Input type="email" placeholder="email" class="max-w-xs" />

<Pagination.Root {count} {perPage} {siblingCount} let:pages let:currentPage>
  <Pagination.Content>
    <Pagination.Item>
      <Pagination.PrevButton>
        <ChevronLeft class="h-4 w-4" />
        <span class="hidden sm:block">Previous</span>
      </Pagination.PrevButton>
    </Pagination.Item>
    {#each pages as page (page.key)}
      {#if page.type === "ellipsis"}
        <Pagination.Item>
          <Pagination.Ellipsis />
        </Pagination.Item>
      {:else}
        <Pagination.Item>
          <Pagination.Link {page} isActive={currentPage === page.value}>
            {page.value}
          </Pagination.Link>
        </Pagination.Item>
      {/if}
    {/each}
    <Pagination.Item>
      <Pagination.NextButton>
        <span class="hidden sm:block">Next</span>
        <ChevronRight class="h-4 w-4" />
      </Pagination.NextButton>
    </Pagination.Item>
  </Pagination.Content>
</Pagination.Root>
