import { WritableComputedOptions } from 'vue'
import { Item, User } from '~/types'

export interface StoreState {
  items: Record<number, Item>
  comments: Record<number, Item[]>
  users: Record<string, User>
  feeds: Record<string, Record<number, number[]>>
}

export const useStore = () => useState<StoreState>('store', () => ({
  items: {},
  users: {},
  comments: {},
  feeds: Object.fromEntries(validFeeds.map(i => [i, {}]))
}))

interface FeedQuery {
   feed: string;
   page: number
  }

export function getFeed (state:StoreState, { feed, page }: FeedQuery) {
  const ids = state.feeds?.[feed]?.[page]
  if (ids?.length) {
    return ids.map(i => state.items[i])
  }
  return undefined
}

export function fetchFeed (query: FeedQuery) {
  const state = useStore()

  const { feed, page } = query

  return reactiveLoad<Item[]>(
    () => getFeed(state.value, query),
    (items) => {
      const ids = items.map(item => item.id)
      state.value.feeds[feed][page] = ids
      items
        .filter(Boolean)
        .forEach((item) => {
          if (state.value.items[item.id]) {
            Object.assign(state.value.items[item.id], item)
          } else {
            state.value.items[item.id] = item
          }
        })
    },
    () => $fetch('/api/hn/feeds', { params: { feed, page } }),
    (state.value.feeds[feed][page] || []).map(id => state.value.items[id])
  )
}

export function fetchItem (id: number) {
  const state = useStore()

  return reactiveLoad<Item>(
    () => state.value.items[id],
    (item) => { state.value.items[id] = item },
    () => $fetch('/api/hn/item', { params: { id } })
  )
}

export function fetchComments (id: number) {
  const state = useStore()

  return reactiveLoad<Item[]>(
    () => state.value.comments[id],
    (comments) => { state.value.comments[id] = comments },
    () => $fetch('/api/hn/item', { params: { id } }).then(i => i.comments!)
  )
}

export function fetchUser (id: string) {
  const state = useStore()

  return reactiveLoad<User>(
    () => state.value.users[id],
    (user) => { state.value.users[id] = user },
    () => $fetch('/api/hn/user', { params: { id } })
  )
}

/**
 * Create reactive state for SWR
 *
 * On server side the data will be fetched eagerly
 */
export async function reactiveLoad<T> (
  get: () => T | undefined,
  set: (data: T) => void,
  fetch: ()=> Promise<T>,
  init?: T
) {
  const data = computed({
    get,
    set
  } as WritableComputedOptions<T | undefined>)
  const loading = ref(false)

  if (data.value == null) {
    if (init != null) {
      data.value = init
    }

    const task = async () => {
      try {
        loading.value = true
        const fetched = await fetch()
        if (data.value != null) {
          data.value = Object.assign(data.value, fetched)
        } else {
          data.value = fetched
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e)
        data.value = undefined
      } finally {
        loading.value = false
      }
    }

    if (process.client) {
      task()
    } else {
      await task()
    }
  }

  return reactive({
    loading,
    data
  })
}
