<script lang="ts">
	import * as Button from '$lib/components/ui/button/index.js';

	type $$Props = Button.Props;
	type $$Events = Button.Events;
</script>

<Button.Root type="submit" on:click on:keydown {...$$restProps}>
	<slot />
</Button.Root>
