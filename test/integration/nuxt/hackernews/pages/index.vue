<script setup lang="ts">
definePageMeta({
  middleware: (from) => {
    if (from.path === '/') {
      return navigateTo(`/${validFeeds[0]}/1`)
    }
  }
})
</script>

<template>
  <div>Index</div>
</template>
