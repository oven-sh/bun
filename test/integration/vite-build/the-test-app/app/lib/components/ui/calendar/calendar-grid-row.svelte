<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	type $$Props = CalendarPrimitive.GridRowProps;

	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<CalendarPrimitive.GridRow class={cn('flex', className)} {...$$restProps}>
	<slot />
</CalendarPrimitive.GridRow>
