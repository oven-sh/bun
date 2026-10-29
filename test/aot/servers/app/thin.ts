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
import { App } from "./thin-framework";

const encoder = new TextEncoder();
const app = new App();

app.on("GET", "/text", (c) => c.text("Hello, World!"));

app.on("GET", "/json", (c) => c.json(catalog(42)));

app.on("GET", "/users/:userId/posts/:postId", (c) =>
  c.json(postPage(c.param("userId"), c.param("postId"), c.query("page"), c.query("limit"), c.query("sort"))),
);

app.on("POST", "/shops/:shop/orders", async (c) => {
  let body: unknown;
  try {
    body = await c.request.json();
  } catch {
    return c.json(invalidOrder, 400);
  }
  const receipt = placeOrder(c.param("shop"), body);
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

app.on("POST", "/shops/:shop/typed-orders", async (c) => {
  try {
    const order = (await c.request.json()) as OrderBody;
    const receipt = placeTypedOrder(c.param("shop"), order);
    return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
  } catch {
    return c.json(invalidOrder, 400);
  }
});

app.on("POST", "/shops/:shop/checked-orders", async (c) => {
  let body: unknown;
  try {
    body = await c.request.json();
  } catch {
    return c.json(invalidOrder, 400);
  }
  const receipt = placeCheckedOrder(c.param("shop"), body);
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

app.on("GET", "/async/:id", async (c) => c.json(await summarize(Number(c.param("id")))));

app.on("GET", "/stream", (c) =>
  c.stream(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of exportProducts()) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    "text/csv",
  ),
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: app.routes,
  fetch: app.fetch,
});

console.log("listening", server.port);
