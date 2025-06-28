<script lang="ts">
	import type { VariantProps } from 'tailwind-variants';
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import { setToggleGroupCtx } from './index';
	import type { toggleVariants } from '$lib/components/ui/toggle/index';
	import { cn } from '$lib/utils';

	type T = $$Generic<'single' | 'multiple'>;
	type $$Props = ToggleGroupPrimitive.Props<T> & VariantProps<typeof toggleVariants>;

	let className: string | undefined | null = undefined;
	export { className as class };
	export let variant: $$Props['variant'] = 'default';
	export let size: $$Props['size'] = 'default';
	export let value: $$Props['value'] = undefined;

	setToggleGroupCtx({
		variant,
		size,
	});
</script>

<ToggleGroupPrimitive.Root
	class={cn('flex items-center justify-center gap-1', className)}
	bind:value
	{...$$restProps}
	let:builder
>
	<slot {builder} />
</ToggleGroupPrimitive.Root>
