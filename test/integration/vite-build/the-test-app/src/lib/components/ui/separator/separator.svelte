<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	type $$Props = SeparatorPrimitive.Props;

	let className: $$Props['class'] = undefined;
	export let orientation: $$Props['orientation'] = 'horizontal';
	export let decorative: $$Props['decorative'] = undefined;
	export { className as class };
</script>

<SeparatorPrimitive.Root
	class={cn(
		'shrink-0 bg-border',
		orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
		className
	)}
	{orientation}
	{decorative}
	{...$$restProps}
/>
