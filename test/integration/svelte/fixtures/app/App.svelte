<script lang="ts">
  let count: number = 0;
</script>

<main>
  <h1 class="title">Svelte App</h1>
  <button on:click={() => count++}>Click me</button>
  <p>Count: {count}</p>
</main>

<style>
  .title {
    color: red;
  }
</style>
