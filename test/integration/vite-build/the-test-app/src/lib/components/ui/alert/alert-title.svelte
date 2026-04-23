<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { HeadingLevel } from './index.js';
	import { cn } from '$lib/utils.js';

	type $$Props = HTMLAttributes<HTMLHeadingElement> & {
		level?: HeadingLevel;
	};

	let className: $$Props['class'] = undefined;
	export let level: $$Props['level'] = 'h5';
	export { className as class };
</script>

<svelte:element
	this={level}
	class={cn('mb-1 font-medium leading-none tracking-tight', className)}
	{...$$restProps}
>
	<slot />
</svelte:element>
