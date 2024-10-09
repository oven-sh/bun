<script setup lang="ts">
import { host, isAbsolute, timeAgo } from "~/composables/utils";

defineProps<{
  item: any;
}>();
</script>

<template>
  <li class="news-item">
    <span
      class="score"
      title="Score"
    >{{ item.points }}</span>
    <span class="title">
      <template v-if="isAbsolute(item.url)">
        <a
          :href="item.url"
          target="_blank"
          rel="noopener"
        >{{ item.title }}</a>
        <span class="host"> ({{ host(item.url) }})</span>
      </template>
      <template v-else>
        <NuxtLink :to="'/item/' + item.id">{{ item.title }}</NuxtLink>
      </template>
    </span>
    <br>
    <span class="meta">
      <span
        v-if="item.type !== 'job'"
        class="by"
      >
        by
        <NuxtLink :to="'/user/' + item.user">{{ item.user }}</NuxtLink>
      </span>
      <span class="time"> {{ timeAgo(item.time) }} ago </span>
      |
      <span
        v-if="item.type !== 'job'"
        class="comments-link"
      >
        <NuxtLink :to="'/item/' + item.id">{{ item.comments_count }} comments</NuxtLink>
      </span>
    </span>
  </li>
</template>

<style lang="postcss">
.news-item {
  background-color: #fff;
  padding: 20px 30px 20px 80px;
  border-bottom: 1px solid #eee;
  position: relative;
  line-height: 20px;

  .score {
    color: #2e495e;
    font-size: 1.1em;
    font-weight: 700;
    position: absolute;
    top: 50%;
    left: 0;
    width: 80px;
    text-align: center;
    margin-top: -10px;
  }

  .meta,
  .host {
    font-size: 0.85em;
    color: #595959;

    & span {
      margin: 0 0.2rem;
    }

    & a {
      color: #595959;
      text-decoration: underline;

      &:hover {
        color: #00c48d;
      }
    }
  }
}
</style>
