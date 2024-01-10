import { $fetch } from 'ofetch'
import { User } from '~/types'
import { baseURL } from '~/server/constants'

async function fetchUser (id: string): Promise<User> {
  const user = await $fetch(`${baseURL}/user/${id}.json`)
  return {
    id: user.id,
    karma: user.karma,
    created_time: user.created,
    about: user.about
  }
}

export default defineEventHandler((event) => {
  configureSWRHeaders(event)
  const { id } = getQuery(event) as { id?: string }

  if (!id) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Must provide a user ID.'
    })
  }
  return fetchUser(id)
})
