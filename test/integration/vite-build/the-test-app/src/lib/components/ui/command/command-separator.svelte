<script lang="ts">
	import { Command as CommandPrimitive } from 'cmdk-sv';
	import { cn } from '$lib/utils.js';

	type $$Props = CommandPrimitive.SeparatorProps;
	let className: string | undefined | null = undefined;
	export { className as class };
</script>

<CommandPrimitive.Separator class={cn('-mx-1 h-px bg-border', className)} {...$$restProps} />
