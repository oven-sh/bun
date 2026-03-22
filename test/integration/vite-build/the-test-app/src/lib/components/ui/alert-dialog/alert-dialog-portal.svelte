<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';

	type $$Props = AlertDialogPrimitive.PortalProps;
</script>

<AlertDialogPrimitive.Portal {...$$restProps}>
	<slot />
</AlertDialogPrimitive.Portal>
