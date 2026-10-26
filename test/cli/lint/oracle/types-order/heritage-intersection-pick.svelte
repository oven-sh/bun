<script lang="ts">
  import type { Imported } from "./imported";
  interface Base { zBase: number; aBase: number }
  interface Local extends Base { used: { zNested: string; used: number; aNested: boolean }; zLocal: number; aLocal: number }
  let props: Local & Imported & Pick<{ zPick: boolean; aPick: number }, "zPick" | "aPick"> = $props();
</script>
