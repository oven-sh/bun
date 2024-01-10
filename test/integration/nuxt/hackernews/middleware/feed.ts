export default defineNuxtRouteMiddleware((from) => {
  if (!from.params.feed || !validFeeds.includes(from.params.feed as string)) {
    return navigateTo(`/${validFeeds[0]}/1`)
  }
  if (!from.params.page) {
    return navigateTo(`/${from.params.feed}/1`)
  }
})
