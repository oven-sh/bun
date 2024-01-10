import { $fetch } from 'ofetch'

import { feedsInfo, validFeeds } from '~/composables/api'

import { baseURL } from '~/server/constants'

const feedUrls: Record<keyof typeof feedsInfo, string> = {
  ask: 'askstories',
  jobs: 'jobstories',
  show: 'showstories',
  newest: 'newstories',
  news: 'topstories'
}

async function fetchFeed (feed: keyof typeof feedsInfo, page = '1') {
  const { fetchItem } = await import('./item.get')
  const entries = Object.values(
    await $fetch(`${baseURL}/${feedUrls[feed]}.json`)
  ).slice((Number(page) - 1) * 10, Number(page) * 10) as string[]
  return Promise.all(entries.map(id => fetchItem(id)))
}

export default defineEventHandler((event) => {
  configureSWRHeaders(event)
  const { page = '1', feed = 'news' } = getQuery(event) as { page: string, feed: keyof typeof feedsInfo }

  if (!validFeeds.includes(feed) || String(Number(page)) !== page) {
    throw createError({
      statusCode: 422,
      statusMessage: `Must provide one of ${validFeeds.join(', ')} and a valid page number.`
    })
  }

  return fetchFeed(feed, page)
})
