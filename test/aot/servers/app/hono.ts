import { Hono } from "hono";
import { stream } from "hono/streaming";
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

const app = new Hono();

app.get("/text", (c) => c.text("Hello, World!"));

app.get("/json", (c) => c.json(catalog(42)));

app.get("/users/:userId/posts/:postId", (c) =>
  c.json(postPage(c.req.param("userId"), c.req.param("postId"), c.req.query("page"), c.req.query("limit"), c.req.query("sort"))),
);

app.post("/shops/:shop/orders", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(invalidOrder, 400);
  }
  const receipt = placeOrder(c.req.param("shop"), body);
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

app.post("/shops/:shop/typed-orders", async (c) => {
  try {
    const order = (await c.req.json()) as OrderBody;
    const receipt = placeTypedOrder(c.req.param("shop"), order);
    return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
  } catch {
    return c.json(invalidOrder, 400);
  }
});

app.post("/shops/:shop/checked-orders", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(invalidOrder, 400);
  }
  const receipt = placeCheckedOrder(c.req.param("shop"), body);
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

app.get("/async/:id", async (c) => c.json(await summarize(Number(c.req.param("id")))));

app.get("/stream", (c) => {
  c.header("Content-Type", "text/csv");
  return stream(c, async (out) => {
    for await (const chunk of exportProducts()) await out.write(chunk);
  });
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
});

console.log("listening", server.port);
