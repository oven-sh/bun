<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';

	import { cn } from '$lib/utils';

	type $$Props = PaginationPrimitive.Props;
	type $$Events = PaginationPrimitive.Events;

	let className: $$Props['class'] = undefined;
	export let count: $$Props['count'] = 0;
	export let perPage: $$Props['perPage'] = 10;
	export let page: $$Props['page'] = 1;
	export let siblingCount: $$Props['siblingCount'] = 1;
	export { className as class };

	$: currentPage = page;
</script>

<PaginationPrimitive.Root
	{count}
	{perPage}
	{siblingCount}
	bind:page
	let:builder
	let:pages
	let:range
	asChild
	{...$$restProps}
>
	<nav {...builder} class={cn('mx-auto flex w-full flex-col items-center', className)}>
		<slot {pages} {range} {currentPage} />
	</nav>
</PaginationPrimitive.Root>
