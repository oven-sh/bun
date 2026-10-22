<script lang="ts">
  import type { Column, TableFeatures } from "./packages";
  type Props = { column?: Pick<Column<TableFeatures, any, unknown>, "getCanSort" | "getIsSorted" | "getToggleSortingHandler">; titleKey: string; class?: string; testId?: string };
  let props: Props = $props();
</script>
