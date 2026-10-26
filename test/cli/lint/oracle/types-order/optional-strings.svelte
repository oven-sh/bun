<script lang="ts">
  import type { Snippet } from "./svelte";
  type CardProps = { title: string; description: string; link?: string; secondaryLink?: string; secondaryTitle?: string; buttonText: string; secondaryButtonText?: string; children?: Snippet };
  let props: CardProps = $props();
</script>
