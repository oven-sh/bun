<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	type $$Props = AlertDialogPrimitive.TitleProps;

	let className: $$Props['class'] = undefined;
	export let level: $$Props['level'] = 'h3';
	export { className as class };
</script>

<AlertDialogPrimitive.Title class={cn('text-lg font-semibold', className)} {level} {...$$restProps}>
	<slot />
</AlertDialogPrimitive.Title>
