import { Hono } from "hono";
import { invalidOrder, placeParsedOrder, placeValidatedOrder } from "./validated";

const app = new Hono();

app.post("/shops/:shop/validated-orders", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(invalidOrder, 400);
  }
  const receipt = placeValidatedOrder(c.req.param("shop"), body);
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

app.post("/shops/:shop/parsed-orders", async (c) => {
  const receipt = placeParsedOrder(c.req.param("shop"), await c.req.text());
  return receipt ? c.json(receipt) : c.json(invalidOrder, 400);
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
});

console.log("listening", server.port);
