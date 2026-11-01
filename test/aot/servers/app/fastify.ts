import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
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

const app = Fastify();

app.get("/text", async () => "Hello, World!");

app.get("/json", async () => catalog(42));

app.get<{
  Params: { userId: string; postId: string };
  Querystring: { page?: string; limit?: string; sort?: string };
}>("/users/:userId/posts/:postId", async (request) => {
  const { page, limit, sort } = request.query;
  return postPage(request.params.userId, request.params.postId, page, limit, sort);
});

app.post<{ Params: { shop: string } }>("/shops/:shop/orders", async (request, reply) => {
  const receipt = placeOrder(request.params.shop, request.body);
  if (receipt) return receipt;
  return reply.code(400).send(invalidOrder);
});

app.post<{ Params: { shop: string } }>("/shops/:shop/typed-orders", async (request, reply) => {
  try {
    const receipt = placeTypedOrder(request.params.shop, request.body as OrderBody);
    if (receipt) return receipt;
  } catch {}
  return reply.code(400).send(invalidOrder);
});

app.post<{ Params: { shop: string } }>("/shops/:shop/checked-orders", async (request, reply) => {
  const receipt = placeCheckedOrder(request.params.shop, request.body);
  if (receipt) return receipt;
  return reply.code(400).send(invalidOrder);
});

app.get<{ Params: { id: string } }>("/async/:id", async (request) => summarize(Number(request.params.id)));

app.get("/stream", (request, reply) => {
  reply.type("text/csv").send(Readable.from(exportProducts()));
});

await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
console.log("listening", (app.server.address() as AddressInfo).port);
