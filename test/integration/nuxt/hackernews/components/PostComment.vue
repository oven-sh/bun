<script setup lang="ts">
import { timeAgo } from '~/composables/utils'

defineProps({
  comment: {
    type: Object,
    required: true
  }
})

const open = ref(true)

function pluralize (n: number) {
  return n + (n === 1 ? ' reply' : ' replies')
}
</script>

<template>
  <li
    v-if="comment && comment.user"
    class="comment"
  >
    <div class="by">
      <NuxtLink :to="'/user/' + comment.user">
        {{ comment.user }}
      </NuxtLink>
      {{ timeAgo(comment.time) }} ago
    </div>
    <div
      class="text"
      v-html="comment.content"
    />
    <div
      v-if="comment.comments && comment.comments.length"
      :class="{ open }"
      class="toggle"
    >
      <a @click="open = !open">{{ open ? '[-]' : '[+] ' + pluralize(comment.comments.length) + ' collapsed' }}
      </a>
    </div>
    <ul
      v-show="open"
      class="comment-children"
    >
      <PostComment
        v-for="childComment in comment.comments"
        :key="childComment.id"
        :comment="childComment"
      />
    </ul>
  </li>
</template>

<style lang="postcss">
.comment-children {
  .comment-children {
    margin-left: 1.5em;
  }
}

.comment {
  border-top: 1px solid #eee;
  position: relative;

  .by, .text, .toggle {
    font-size: 0.9em;
    margin: 1em 0;
  }

  .by {
    color: #222;

    & a {
      color: #222;
      text-decoration: underline;
    }
  }

  .text {
    overflow-wrap: break-word;

    & a:hover {
      color: #111;
    }

    & pre {
      white-space: pre-wrap;
    }
  }

  .toggle {
    background-color: #fffbf2;
    padding: 0.3em 0.5em;
    border-radius: 4px;

    & a {
      color: #222;
      cursor: pointer;
    }

    &.open {
      padding: 0;
      background-color: transparent;
      margin-bottom: -0.5em;
    }
  }
}
</style>
