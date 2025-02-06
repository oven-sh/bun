<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	type $$Props = CalendarPrimitive.HeadCellProps;

	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<CalendarPrimitive.HeadCell
	class={cn('w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground', className)}
	{...$$restProps}
>
	<slot />
</CalendarPrimitive.HeadCell>
