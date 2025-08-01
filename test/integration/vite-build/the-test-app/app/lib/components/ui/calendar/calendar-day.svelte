<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type $$Props = CalendarPrimitive.DayProps;
	type $$Events = CalendarPrimitive.DayEvents;

	export let date: $$Props['date'];
	export let month: $$Props['month'];
	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<CalendarPrimitive.Day
	on:click
	{date}
	{month}
	class={cn(
		buttonVariants({ variant: 'ghost' }),
		'h-9 w-9 p-0 font-normal ',
		'[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground',
		// Selected
		'data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:opacity-100 data-[selected]:hover:bg-primary data-[selected]:hover:text-primary-foreground data-[selected]:focus:bg-primary data-[selected]:focus:text-primary-foreground',
		// Disabled
		'data-[disabled]:text-muted-foreground data-[disabled]:opacity-50',
		// Unavailable
		'data-[unavailable]:text-destructive-foreground data-[unavailable]:line-through',
		// Outside months
		'data-[outside-month]:pointer-events-none data-[outside-month]:text-muted-foreground data-[outside-month]:opacity-50 [&[data-outside-month][data-selected]]:bg-accent/50 [&[data-outside-month][data-selected]]:text-muted-foreground [&[data-outside-month][data-selected]]:opacity-30',
		className
	)}
	{...$$restProps}
	let:selected
	let:disabled
	let:unavailable
	let:builder
>
	<slot {selected} {disabled} {unavailable} {builder}>
		{date.day}
	</slot>
</CalendarPrimitive.Day>
