<!-- source: https://svelte.dev/playground/7eb8c1dd6cac414792b0edb53521ab49?version=5.20.4 -->
<script>
  let newItem = "";

  let todoList = [
    { text: "Write my first post", status: true },
    { text: "Upload the post to the blog", status: false },
    { text: "Publish the post at Facebook", status: false },
  ];

  function addToList() {
    todoList = [...todoList, { text: newItem, status: false }];
    newItem = "";
  }

  function removeFromList(index) {
    todoList.splice(index, 1);
    todoList = todoList;
  }
</script>

<main>
  <h1 class="title">Todo List</h1>
  <input bind:value={newItem} type="text" placeholder="new todo item.." />
  <button on:click={addToList}>Add</button>

  <br />
  {#each todoList as item, index}
    <input bind:checked={item.status} type="checkbox" />
    <span class:checked={item.status}>{item.text}</span>
    <span role="button" on:click={() => removeFromList(index)}>❌</span>
    <br />
  {/each}
</main>

<style>
  .title {
    font-weight: bold;
  }

  .checked {
    text-decoration: line-through;
  }
</style>
