<script setup lang="ts">
defineProps<{
  loading: boolean,
}>()
</script>

<template>
  <div
    v-if="loading"
    style="text-align:center"
  >
    <LoadSpinner />
  </div>
  <slot v-else />
</template>
