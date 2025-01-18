<script>
    import Counter from "./_Counter.svelte";
</script>
<main>
    <h1>hello</h1>
    <p>This is my svelte server component (non-interactive)</p>
    <p>Bun v{Bun.version}</p>
    <Counter initial={5} />
</main>
<style>
    main {
        border: 1px solid blue;
        padding: 1rem;
        h1 {
            color: blue;
        }
    }
</style>