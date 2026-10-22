<script lang="ts">
  type Field = "notifyNewComments" | "notifyReplies" | "notifyNewUsers" | "notifyNewOrders";
  interface Props { email: string; field: Field; checked: boolean }
  let props: Props = $props();
</script>
