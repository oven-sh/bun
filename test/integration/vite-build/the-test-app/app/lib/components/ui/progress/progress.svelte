<script lang="ts">
	import { cn } from '$lib/utils';
	import { Progress as ProgressPrimitive } from 'bits-ui';

	type $$Props = ProgressPrimitive.Props;

	let className: $$Props['class'] = undefined;
	export let max: $$Props['max'] = 100;
	export let value: $$Props['value'] = undefined;
	export { className as class };
</script>

<ProgressPrimitive.Root
	class={cn('relative h-4 w-full overflow-hidden rounded-full bg-secondary', className)}
	{...$$restProps}
>
	<div
		class="h-full w-full flex-1 bg-green-700 transition-all"
		style={`transform: translateX(-${100 - (100 * (value ?? 0)) / (max ?? 1)}%)`}
	></div>
</ProgressPrimitive.Root>
