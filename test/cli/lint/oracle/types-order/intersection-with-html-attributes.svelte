<script lang="ts">
  import type { Snippet } from "./svelte";
  import type { HTMLAttributes } from "./html";
  let props: { content?: string; markdown?: boolean; class?: string; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props();
</script>
