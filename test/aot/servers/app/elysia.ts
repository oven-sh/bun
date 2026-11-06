import { Elysia } from "elysia";
import {
  catalog,
  exportProducts,
  invalidOrder,
  placeCheckedOrder,
  placeOrder,
  placeTypedOrder,
  postPage,
  summarize,
  type OrderBody,
} from "./shared";

const app = new Elysia()
  .get("/text", () => "Hello, World!")
  .get("/json", () => catalog(42))
  .get("/users/:userId/posts/:postId", ({ params, query }) =>
    postPage(params.userId, params.postId, query.page, query.limit, query.sort),
  )
  .post("/shops/:shop/orders", ({ params, body, status }) => placeOrder(params.shop, body) ?? status(400, invalidOrder))
  .post("/shops/:shop/typed-orders", ({ params, body, status }) => {
    try {
      return placeTypedOrder(params.shop, body as OrderBody) ?? status(400, invalidOrder);
    } catch {
      return status(400, invalidOrder);
    }
  })
  .post("/shops/:shop/checked-orders", ({ params, body, status }) => placeCheckedOrder(params.shop, body) ?? status(400, invalidOrder))
  .get("/async/:id", ({ params }) => summarize(Number(params.id)))
  .get("/stream", async function* ({ set }) {
    set.headers["content-type"] = "text/csv";
    for await (const chunk of exportProducts()) yield chunk;
  })
  .listen({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });

console.log("listening", app.server?.port);
