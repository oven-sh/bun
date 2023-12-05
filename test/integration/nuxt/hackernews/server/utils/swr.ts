import { H3Event } from 'h3'

export function configureSWRHeaders (event: H3Event) {
  setHeader(event, 'Cache-Control', 's-maxage=10, stale-while-revalidate')
}
