<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn, flyAndScale } from '$lib/utils.js';

	type $$Props = DropdownMenuPrimitive.ContentProps;
	type $$Events = DropdownMenuPrimitive.ContentEvents;

	let className: $$Props['class'] = undefined;
	export let sideOffset: $$Props['sideOffset'] = 4;
	export let transition: $$Props['transition'] = flyAndScale;
	export let transitionConfig: $$Props['transitionConfig'] = undefined;
	export { className as class };
</script>

<DropdownMenuPrimitive.Content
	{transition}
	{transitionConfig}
	{sideOffset}
	class={cn(
		'z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md focus:outline-none',
		className
	)}
	{...$$restProps}
	on:keydown
>
	<slot />
</DropdownMenuPrimitive.Content>
