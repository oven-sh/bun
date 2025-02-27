<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { scale } from 'svelte/transition';
	import { cn, flyAndScale } from '$lib/utils';

	type $$Props = SelectPrimitive.ContentProps;
	type $$Events = SelectPrimitive.ContentEvents;

	export let sideOffset: $$Props['sideOffset'] = 4;
	export let inTransition: $$Props['inTransition'] = flyAndScale;
	export let inTransitionConfig: $$Props['inTransitionConfig'] = undefined;
	export let outTransition: $$Props['outTransition'] = scale;
	export let outTransitionConfig: $$Props['outTransitionConfig'] = {
		start: 0.95,
		opacity: 0,
		duration: 50,
	};

	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<SelectPrimitive.Content
	{inTransition}
	{inTransitionConfig}
	{outTransition}
	{outTransitionConfig}
	{sideOffset}
	class={cn(
		'relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-muted-foreground-light shadow-md outline-none',
		className
	)}
	{...$$restProps}
	on:keydown
>
	<div class="w-full p-1">
		<slot />
	</div>
</SelectPrimitive.Content>
