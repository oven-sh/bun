<script setup lang="ts">
const route = useRoute()
const id = computed(() => +route.params.id)

const [resultItem, resultComments] = await Promise.all([fetchItem(id.value), fetchComments(id.value)])
const { data: item } = toRefs(resultItem)
const { data: comments, loading: commentsLoading } = toRefs(resultComments)

useHead({
  title: item.value?.title
})
</script>

<template>
  <div class="item-view view">
    <div
      v-if="!item?.url"
      class="item-view-header"
    >
      <h1>Page not found</h1>
    </div>
    <template v-else>
      <div class="item-view-header">
        <template v-if="isAbsolute(item.url)">
          <a
            :href="item.url"
            target="_blank"
            rel="noopener"
          ><h1 v-text="item.title" /></a>
          <span class="host"> ({{ host(item.url) }})</span>
        </template>
        <template v-else>
          <h1 v-text="item.title" />
        </template>
        <p class="meta">
          {{ item.points }} points | by
          <NuxtLink :to="'/user/' + item.user">
            {{ item.user }}
          </NuxtLink>
          {{ timeAgo(+item.time) }} ago
        </p>
      </div>
      <div class="item-view-comments">
        <LoadingWrapper :loading="commentsLoading">
          <p class="item-view-comments-header">
            {{ comments ? comments.length + ' comments' : 'No comments yet.' }}
          </p>
          <ul class="comment-children">
            <PostComment
              v-for="comment in comments"
              :key="comment.id"
              :comment="comment"
            />
          </ul>
        </LoadingWrapper>
      </div>
    </template>
  </div>
</template>

<style lang="postcss">
.item-view-header {
  background-color: #fff;
  padding: 1.8em 2em 1em;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);

  & h1 {
    display: inline;
    font-size: 1.5em;
    margin: 0;
    margin-right: 0.5em;
  }

  .host, .meta, .meta a {
    color: #595959;
  }
  .meta a:hover {
    color: #00C48D;
  }

  .meta a {
    text-decoration: underline;
  }
}

.item-view-comments {
  background-color: #fff;
  margin-top: 10px;
  padding: 0 2em 0.5em;
}

.item-view-comments-header {
  margin: 0;
  font-size: 1.1em;
  padding: 1em 0;
  position: relative;

  .spinner {
    display: inline-block;
    margin: -15px 0;
  }
}

.comment-children {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

@media (max-width: 600px) {
  .item-view-header {
    & h1 {
      font-size: 1.25em;
    }
  }
}
</style>
