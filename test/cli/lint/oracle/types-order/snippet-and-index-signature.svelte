<script lang="ts">
  import type { Snippet } from "./svelte";
  let props: { children?: Snippet; class?: string; [key: string]: any } = $props();
</script>
