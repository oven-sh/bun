<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	type $$Props = HTMLAttributes<HTMLLIElement>;
	let className: $$Props['class'] = undefined;

	export { className as class };
</script>

<li class={cn('text-muted-foreground-light', className)} {...$$restProps}>
	<slot />
</li>
