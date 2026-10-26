<script lang="ts">
  import type { Snippet } from "./svelte";
  type Props = { asChild?: boolean; class?: string; children: Snippet; onclick?: (e: MouseEvent) => void; [key: string]: any };
  let props: Props = $props();
</script>
