<script lang="ts">
  import type { ComponentProps } from "./svelte";
  declare const Input: unknown;
  let props: { initialId: string; variant: string } & Pick<ComponentProps<typeof Input>, "onSend"> = $props();
</script>
