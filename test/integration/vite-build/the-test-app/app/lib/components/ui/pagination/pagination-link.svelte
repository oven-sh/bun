<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';
	import { type Props, buttonVariants } from '$lib/components/ui/button/index';

	type $$Props = PaginationPrimitive.PageProps &
		Props & {
			isActive: boolean;
		};

	type $$Events = PaginationPrimitive.PageEvents;

	let className: $$Props['class'] = undefined;
	export let page: $$Props['page'];
	export let size: $$Props['size'] = 'icon';
	export let isActive: $$Props['isActive'] = false;

	export { className as class };
</script>

<PaginationPrimitive.Page
	bind:page
	class={cn(
		buttonVariants({
			variant: isActive ? 'outline' : 'ghost',
			size,
		}),
		className
	)}
	{...$$restProps}
	on:click
>
	<slot>{page.value}</slot>
</PaginationPrimitive.Page>
