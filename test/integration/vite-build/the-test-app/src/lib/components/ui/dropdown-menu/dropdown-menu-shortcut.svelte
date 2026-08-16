<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	type $$Props = HTMLAttributes<HTMLSpanElement>;

	let className: $$Props['class'] = undefined;
	export { className as class };
</script>

<span class={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...$$restProps}>
	<slot />
</span>
