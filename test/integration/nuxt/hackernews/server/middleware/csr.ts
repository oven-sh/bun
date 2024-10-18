export default defineEventHandler((event) => {
  const query = getQuery(event)

  if (typeof query.csr !== 'undefined') {
    event.node.req.headers['x-nuxt-no-ssr'] = 'true'
  }
})
