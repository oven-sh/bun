<script lang="ts">
  interface Props {
    /** Button variant */
    variant?: "outline" | "ghost";
    /** Dropdown alignment */
    align?: "start" | "center" | "end";
    /** Custom class */
    class?: string;
  }
  let props: Props = $props();
</script>
