<script lang="ts">
  import type { Snippet } from "./svelte";
  interface LinkToken { href: string; title?: string | null }
  let props: { children: Snippet; token: LinkToken; transformedHref: string | null; currentUrl: Pick<URL, "href">; localize: (path: string) => string } = $props();
</script>
