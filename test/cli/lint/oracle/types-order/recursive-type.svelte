<script lang="ts">
  type TreeNode = { initialize: () => string | void; children?: TreeNode[] };
  let props: { node: TreeNode } = $props();
</script>
