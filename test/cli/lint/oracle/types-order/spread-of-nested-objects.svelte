<script lang="ts">
  const base = { left: { used: 1, missing: 2 } };
  const both = { ...base, right: { used: 3, missing: 4 } };
  let props: typeof both = $props();
</script>
