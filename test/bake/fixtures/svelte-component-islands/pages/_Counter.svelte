<script>
    "use client";
    let { initial } = $props();
    let count = $state(initial);
    function increment() {
        count += 1;
    }
</script>

<div>
    <p>This is a client component (interactive island)</p>
    <button onclick={increment}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
    </button>
</div>
<style>
    div {
        border: 1px solid red;
        padding: 1rem;
        p {
            color: red;
        }
    }
</style>
