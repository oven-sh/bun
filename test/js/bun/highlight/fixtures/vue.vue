<!-- A list of todos with a filter. -->
<script lang="ts">
export default { name: "TodoList", inheritAttrs: false };
</script>

<script setup lang="ts" generic="T extends { id: number; title: string }">
import { computed, ref } from "vue";
import TodoItem from "./TodoItem.vue";

const props = defineProps<{ items: T[]; max?: number }>();
const emit = defineEmits<{ remove: [id: number] }>();
const filter = ref("");
const count = ref(0);
const visible = computed(() => props.items.filter(it => it.title.includes(filter.value)));
</script>

<template>
  <section class="todos" :class="{ empty: !visible.length, 'is-full': visible.length >= (max ?? 10) }">
    <h2 v-once>{{ $t("title") }} &ndash; {{ visible.length }} / {{ items.length }}</h2>
    <input v-model.trim="filter" type="search" :placeholder="$t('search')" @keyup.esc="filter = ''" />
    <p v-if="!items.length" style="color: gray; margin: 0">{{ $t("empty") }}</p>
    <p v-else-if="!visible.length">No match for "{{ filter }}".</p>
    <ul v-else v-show="count >= 0">
      <li v-for="(item, index) in visible" :key="item.id" :data-index="index">
        <TodoItem
          v-bind="item"
          :title="item.title.toUpperCase()"
          :[`data-${index}`]="true"
          .hidden="false"
          @remove="emit('remove', item.id)"
          @click.stop="count++; filter = ''"
          @hover="function (event) { console.log(event); }"
          v-on:focus="(event: FocusEvent) => console.log(event.target)"
        >
          <template #default="{ done, toggle }">
            <input type="checkbox" :checked="done" @change="toggle" />
          </template>
          <template v-slot:footer="slotProps">
            <small v-text="slotProps.note" />
          </template>
        </TodoItem>
      </li>
      <li v-for="n of 3" :key="n">{{ n }}</li>
      <li v-for="{ id, title } in items" :key="id" v-html="title"></li>
    </ul>
    <my-counter :value="count" onclick="console.log('native')"></my-counter>
    <component :is="count > 1 ? 'b' : 'i'">{{ count > 1 ? "many" : `only ${count}` }}</component>
    <svg viewBox="0 0 4 4"><linearGradient id="g" /></svg>
  </section>
</template>

<style scoped lang="scss">
$gap: 8px;
.todos {
  display: grid;
  gap: $gap;
  &.empty { opacity: 0.5; }
  li:hover { color: v-bind("theme.color"); }
}
</style>

<style>
.is-full { border: 1px solid red; }
</style>

<style lang="less">
@pad: 2px;
.todos { padding: @pad; }
</style>

<i18n>
{
  "en": { "title": "Todos", "search": "Search", "empty": "Nothing to do" }
}
</i18n>

<i18n lang="yaml">
de:
  title: Aufgaben
  empty: Nichts zu tun
</i18n>

<route lang="json5">
{ path: "/todos", meta: { requiresAuth: true } }
</route>

<docs>
Shows a list of todos. This block has no language, so <it> stays {{ plain }}.
</docs>
