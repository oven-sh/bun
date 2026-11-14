import { Context, DateTime, Effect, Layer, Redacted } from "effect"
import { User, UserId, UserNotFound } from "../domain/User.ts"

const cities = ["Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"] as const

export class Users extends Context.Service<Users, {
  findById(id: UserId): Effect.Effect<User, UserNotFound>
}>()("aot/Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function*() {
      const users = new Map<UserId, User>()
      for (let n = 1; n <= 100; n++) {
        const id = UserId.make(n)
        users.set(
          id,
          new User({
            id,
            name: `User ${n}`,
            email: `user${n}@example.com`,
            age: 20 + (n % 50),
            active: n % 2 === 0,
            score: n + 0.5,
            role: n % 10 === 0 ? "admin" : "member",
            city: cities[n % cities.length]!,
            createdAt: DateTime.makeUnsafe(`2026-01-${String(1 + (n % 28)).padStart(2, "0")}T00:00:00.000Z`),
            visits: n * 37,
            passwordHash: Redacted.make(`hash-${n}`)
          })
        )
      }

      const findById = Effect.fn("Users.findById")(function*(id: UserId) {
        const user = users.get(id)
        if (user === undefined) {
          return yield* new UserNotFound({ id })
        }
        return user
      })

      return Users.of({ findById })
    })
  )
}
