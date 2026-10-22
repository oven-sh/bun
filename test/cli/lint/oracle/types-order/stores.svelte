<script lang="ts">
  import type { Readable } from "./svelte";
  let props: { stores: Readable<number>[]; promise: Promise<Readable<string>>; maybe: Readable<number> | null } = $props();
</script>
