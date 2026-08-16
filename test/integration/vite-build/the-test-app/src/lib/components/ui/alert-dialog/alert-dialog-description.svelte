<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	type $$Props = AlertDialogPrimitive.DescriptionProps;

	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<AlertDialogPrimitive.Description
	class={cn('text-sm text-muted-foreground', className)}
	{...$$restProps}
>
	<slot />
</AlertDialogPrimitive.Description>
