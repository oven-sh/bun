import { Effect, Layer, Option, Stream } from "effect"
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api"
import { Api, Catalog, InvalidOrders, OrderCount, PostPage } from "../api/Api.ts"
import { InvalidOrder } from "../domain/Order.ts"
import { Item } from "../domain/Product.ts"
import { Profile, Summary, UserId } from "../domain/User.ts"
import { Orders } from "./Orders.ts"
import { Products } from "./Products.ts"
import { Users } from "./Users.ts"

const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("text", () => Effect.succeed("Hello, World!")))

const UsersHandlers = HttpApiBuilder.group(
  Api,
  "users",
  Effect.fn(function*(handlers) {
    const users = yield* Users
    const products = yield* Products
    const orders = yield* Orders

    const summarize = Effect.fn("summarize")(function*(id: UserId) {
      const user = yield* users.findById(id)
      const past = yield* orders.findByUser(user.id)
      const totalCents = yield* orders.total(past)
      return new Summary({ id: user.id, name: user.name, orders: past.length, totalCents })
    })

    return handlers.handleAll({
      catalog: Effect.fn(function*() {
        const user = yield* users.findById(UserId.make(42))
        const all = yield* products.all
        return new Catalog({
          profile: new Profile(user),
          items: all.map((product) =>
            new Item({
              id: product.id,
              title: product.title,
              priceCents: product.priceCents,
              inStock: product.stock > 0
            })
          )
        })
      }),
      profile: Effect.fn(function*({ params }) {
        const user = yield* users.findById(params.userId)
        return new Profile(user)
      }),
      posts: ({ params, query }) =>
        Effect.succeed(
          new PostPage({
            userId: params.userId,
            postId: params.postId,
            page: query.page ?? 1,
            limit: Math.min(query.limit ?? 20, 100),
            sort: query.sort ?? "new"
          })
        ),
      summary: ({ params }) => summarize(params.userId),
      summaries: ({ query }) =>
        Effect.forEach(
          Array.from({ length: 10 }, (_, n) => UserId.make(query.from + n)),
          summarize,
          { concurrency: "unbounded" }
        )
    })
  })
)

const ProductsHandlers = HttpApiBuilder.group(
  Api,
  "products",
  Effect.fn(function*(handlers) {
    const products = yield* Products

    const rows = Stream.paginate(0, (offset: number) =>
      Effect.map(products.page(offset, 5), (page) =>
        [
          [page.map((product) => `${product.id},${product.title},${product.priceCents}\n`).join("")],
          page.length === 5 && offset + 5 < 50 ? Option.some(offset + 5) : Option.none<number>()
        ] as const))

    return handlers.handleAll({
      list: () => products.all,
      export: () => Effect.succeed(Stream.encodeText(rows))
    })
  })
)

const OrdersHandlers = HttpApiBuilder.group(
  Api,
  "orders",
  Effect.fn(function*(handlers) {
    const orders = yield* Orders

    return handlers.handleAll({
      place: ({ params, payload }) => orders.place(params.shop, payload),
      count: Effect.fn(function*() {
        return new OrderCount({ placed: yield* orders.placed })
      })
    })
  })
)

const InvalidOrdersLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  InvalidOrders,
  () => Effect.fail(new InvalidOrder({ error: "invalid order" }))
)

export const ApiRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([SystemHandlers, UsersHandlers, ProductsHandlers, OrdersHandlers]),
  Layer.provide(InvalidOrdersLayer),
  Layer.provide([Users.layer, Products.layer, Orders.layer])
)
