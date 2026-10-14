<svelte:options runes />

<script module lang="ts">
  export type Todo = { id: number; text: string; done: boolean };
</script>

<script lang="ts" generics="T extends { id: number }">
  import { flip } from "svelte/animate";
  import { fade, fly } from "svelte/transition";
  import { clickOutside, tooltip } from "./actions";
  import Button from "./Button.svelte";
  import * as ui from "./ui";

  let { title = "Todos", groups = {}, children, ...rest }: Props<T> = $props();
  let todos = $state<Todo[]>([]);
  let draft = $state("");
  let width = $state(0);
  let remaining = $derived(todos.filter((todo) => !todo.done).length);
  const request = fetch("/api/todos").then((response) => response.json());

  function add(event: SubmitEvent) {
    event.preventDefault();
    todos.push({ id: Date.now(), text: draft, done: false });
    draft = "";
  }
</script>

<svelte:head>
  <title>{title} &middot; {remaining} left</title>
  <script type="application/ld+json">
    { "@type": "ItemList", "name": "Todos" }
  </script>
  <script src="/js/{title}.js" defer></script>
</svelte:head>

<svelte:window on:keydown|preventDefault={() => (draft = "")} bind:innerWidth={width} />

<!-- The form: a < b, {not a tag} -->
<form class="new {draft ? 'dirty' : ''} wide" on:submit={add} {...rest}>
  <input
    // the text of the next todo
    bind:value={draft}
    placeholder="What&apos;s next?"
    type=text
    /* nothing is suggested */
    autocomplete="off"
    {@attach tooltip("Press enter")}
  />
  <Button {title} disabled={draft.length === 0} let:pressed>Add &amp; close &#x2192;</Button>
  <ui.Icon name="plus" size={width / 100} />
</form>
<p>{#if draft}<b>{draft}</b>{/if} {#each { length: 3 }, n}{n + 1}/3 {/each}</p>

{#snippet row(todo: Todo, index: number)}
  {@const label = `${index + 1}. ${todo.text.replace(/[{}]/g, "")}`}
  <label>
    <input type="checkbox" bind:checked={todo.done} />
    {label}
  </label>
{/snippet}

{#if todos.length === 0}
  <p transition:fade>Nothing to do.</p>
{:else if remaining === 0}
  <p style="color: green; font-weight: bold">All done!</p>
{:else}
  <ul use:clickOutside={() => (draft = "")}>
    {#each todos as todo, i (todo.id)}
      <li
        class:done={todo.done}
        style:--delay="{i * 50}ms"
        animate:flip={{ duration: 200 }}
        in:fly={{ y: 20 }}
        out:fade|local
      >
        {@render row(todo, i)}
      </li>
    {:else}
      <li>Empty</li>
    {/each}
  </ul>
{/if}

{#each Object.entries(groups) as [name, { count = 0 }]}
  {const half = count / 2}
  <span>{name}: {half}</span>
{/each}

{#await request}
  <p>Loading&hellip;</p>
{:then data}
  {@html data.summary}
{:catch error}
  <p class="error">{error.message}</p>
{/await}

{#await request then { total }}<b>{total}</b>{/await}

{#key remaining}
  <svelte:element this={remaining > 3 ? "strong" : "em"}>{remaining}</svelte:element>
{/key}

{@debug todos, draft}
{@render children?.()}

<style lang="scss">
  $accent: #ff3e00;

  form.new {
    display: flex;

    input:focus {
      outline: 2px solid $accent;
    }
  }
</style>
