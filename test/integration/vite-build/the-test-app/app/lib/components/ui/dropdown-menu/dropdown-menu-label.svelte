<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	type $$Props = DropdownMenuPrimitive.LabelProps & {
		inset?: boolean;
	};

	let className: $$Props['class'] = undefined;
	export let inset: $$Props['inset'] = undefined;
	export { className as class };
</script>

<DropdownMenuPrimitive.Label
	class={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
	{...$$restProps}
>
	<slot />
</DropdownMenuPrimitive.Label>
