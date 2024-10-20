<script setup lang="ts">
const route = useRoute()
const id = computed(() => route.params.id as string)

const result = await fetchUser(id.value)
const { data: user, loading } = toRefs(result)

useHead({
  title: loading.value
    ? 'Loading'
    : user.value
      ? user.value.id
      : 'User not found'
})
</script>

<template>
  <div class="user-view view">
    <LoadSpinner v-if="loading" />
    <template v-else-if="user">
      <h1>User: {{ user.id }}</h1>
      <ul class="meta">
        <li>
          <span class="label">Created:</span> {{ timeAgo(new Date(user.created_time)) }} ago
        </li>
        <li>
          <span class="label">Karma:</span> {{ user.karma || '-' }}
        </li>
        <li
          v-if="user.about"
          class="about"
          v-html="user.about"
        />
      </ul>
      <p class="links">
        <a :href="'https://news.ycombinator.com/submitted?id=' + user.id">submissions</a> |
        <a :href="'https://news.ycombinator.com/threads?id=' + user.id">comments</a>
      </p>
    </template>
    <template v-else>
      <h1>User not found.</h1>
    </template>
  </div>
</template>

<style lang="postcss">
.user-view {
  background-color: #fff;
  box-sizing: border-box;
  padding: 2em 3em;

  & h1 {
    margin: 0;
    font-size: 1.5em;
  }

  .meta {
    list-style-type: none;
    padding: 0;
  }

  .label {
    display: inline-block;
    min-width: 4em;
  }

  .about {
    margin: 1em 0;
  }

  .links a {
    text-decoration: underline;
  }
}
</style>
