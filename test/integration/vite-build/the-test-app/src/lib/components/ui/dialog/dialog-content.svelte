<script lang="ts">
	import { cn, flyAndScale } from '$lib/utils';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import * as Dialog from './index';

	type $$Props = DialogPrimitive.ContentProps & { overlayClass?: string | null | undefined };

	let className: $$Props['class'] = undefined;
	export let overlayClass: $$Props['overlayClass'] = undefined;
	export let transition: $$Props['transition'] = flyAndScale;
	export let transitionConfig: $$Props['transitionConfig'] = {
		duration: 200,
	};
	export { className as class };
</script>

<Dialog.Portal>
	<Dialog.Overlay class={overlayClass} />
	<DialogPrimitive.Content
		{transition}
		{transitionConfig}
		class={cn(
			'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90dvw] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg md:w-full md:max-w-lg',
			className
		)}
		{...$$restProps}
	>
		<slot />
	</DialogPrimitive.Content>
</Dialog.Portal>
