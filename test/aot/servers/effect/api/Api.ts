import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from "effect/http-api"
import { InvalidOrder, Order, Receipt, Shop } from "../domain/Order.ts"
import { Item, Product } from "../domain/Product.ts"
import { Profile, Summary, UserId, UserNotFound } from "../domain/User.ts"

const Positive = Schema.Int.check(Schema.isGreaterThan(0))

export class Catalog extends Schema.Class<Catalog>("Catalog")({
  profile: Profile,
  items: Schema.Array(Item)
}) {}

export class PostPage extends Schema.Class<PostPage>("PostPage")({
  userId: UserId,
  postId: Schema.String,
  page: Positive,
  limit: Positive,
  sort: Schema.Literals(["new", "top"])
}) {}

export class OrderCount extends Schema.Class<OrderCount>("OrderCount")({
  placed: Schema.Int
}) {}

export class InvalidOrders extends HttpApiMiddleware.Service<InvalidOrders>()("aot/InvalidOrders", {
  error: InvalidOrder
}) {}

export class SystemApi extends HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("text", "/text", {
    success: Schema.String.pipe(HttpApiSchema.asText())
  })
) {}

export class UsersApi extends HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("catalog", "/json", {
    success: Catalog,
    error: UserNotFound
  }),
  HttpApiEndpoint.get("profile", "/users/:userId", {
    params: { userId: UserId },
    success: Profile,
    error: UserNotFound
  }),
  HttpApiEndpoint.get("posts", "/users/:userId/posts/:postId", {
    params: { userId: UserId, postId: Schema.String },
    query: {
      page: Schema.optionalKey(Positive),
      limit: Schema.optionalKey(Positive),
      sort: Schema.optionalKey(Schema.Literals(["new", "top"]))
    },
    success: PostPage
  }),
  HttpApiEndpoint.get("summary", "/async/:userId", {
    params: { userId: UserId },
    success: Summary,
    error: UserNotFound
  }),
  HttpApiEndpoint.get("summaries", "/summaries", {
    query: { from: UserId },
    success: Schema.Array(Summary),
    error: UserNotFound
  })
) {}

export class ProductsApi extends HttpApiGroup.make("products").add(
  HttpApiEndpoint.get("list", "/products", {
    success: Schema.Array(Product)
  }),
  HttpApiEndpoint.get("export", "/stream", {
    success: HttpApiSchema.StreamUint8Array({ contentType: "text/csv" })
  })
) {}

export class OrdersApi extends HttpApiGroup.make("orders").add(
  HttpApiEndpoint.post("place", "/shops/:shop/orders", {
    params: { shop: Shop },
    payload: Order,
    success: Receipt
  }).middleware(InvalidOrders),
  HttpApiEndpoint.get("count", "/orders/count", {
    success: OrderCount
  })
) {}

export class Api extends HttpApi.make("shop")
  .add(SystemApi)
  .add(UsersApi)
  .add(ProductsApi)
  .add(OrdersApi)
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
{}
