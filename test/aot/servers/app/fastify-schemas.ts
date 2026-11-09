// ./fastify.ts with the schemas that Fastify's documentation recommends: one for the body of an order, which ajv
// validates, and one for every JSON response, which fast-json-stringify serializes. Both packages generate code from a
// schema with `new Function` when the route is registered.
import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  catalog,
  exportProducts,
  invalidOrder,
  placeOrder,
  placeTypedOrder,
  postPage,
  summarize,
  type OrderBody,
} from "./shared";

// By default Fastify's ajv removes unknown keys and converts "5" to 5. The other servers reject such an order.
const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });

const integer = { type: "integer" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const string = { type: "string" };

const order = {
  type: "object",
  additionalProperties: false,
  required: ["customer", "items"],
  properties: {
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "email"],
      properties: {
        id: { type: "integer", minimum: 1 },
        name: { type: "string", minLength: 1, maxLength: 100 },
        email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+$" },
      },
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "quantity", "unitCents"],
        properties: {
          sku: { type: "string", minLength: 1, maxLength: 32 },
          quantity: { type: "integer", minimum: 1, maximum: 1000 },
          unitCents: { type: "integer", minimum: 0 },
        },
      },
    },
    coupon: { type: "string", maxLength: 16 },
  },
};

const receipt = {
  type: "object",
  properties: {
    shop: string,
    customerId: integer,
    lines: { type: "array", items: { type: "object", properties: { sku: string, lineCents: integer } } },
    subtotalCents: integer,
    discountCents: integer,
    taxCents: integer,
    totalCents: integer,
  },
};

const profile = {
  type: "object",
  properties: {
    id: integer,
    name: string,
    email: string,
    age: integer,
    active: boolean,
    score: number,
    role: string,
    city: string,
    createdAt: string,
    visits: integer,
  },
};

const item = { type: "object", properties: { id: integer, title: string, priceCents: integer, inStock: boolean } };

app.get("/text", async () => "Hello, World!");

app.get(
  "/json",
  { schema: { response: { 200: { type: "object", properties: { profile, items: { type: "array", items: item } } } } } },
  async () => catalog(42),
);

app.get<{
  Params: { userId: string; postId: string };
  Querystring: { page?: string; limit?: string; sort?: string };
}>(
  "/users/:userId/posts/:postId",
  {
    schema: {
      response: {
        200: {
          type: "object",
          properties: { userId: number, postId: string, page: integer, limit: integer, sort: string },
        },
      },
    },
  },
  async (request) => {
    const { page, limit, sort } = request.query;
    return postPage(request.params.userId, request.params.postId, page, limit, sort);
  },
);

app.post<{ Params: { shop: string } }>(
  "/shops/:shop/orders",
  { schema: { response: { 200: receipt } } },
  async (request, reply) => {
    const made = placeOrder(request.params.shop, request.body);
    if (made) return made;
    return reply.code(400).send(invalidOrder);
  },
);

app.post<{ Params: { shop: string } }>(
  "/shops/:shop/typed-orders",
  { schema: { response: { 200: receipt } } },
  async (request, reply) => {
    try {
      const made = placeTypedOrder(request.params.shop, request.body as OrderBody);
      if (made) return made;
    } catch {}
    return reply.code(400).send(invalidOrder);
  },
);

app.post<{ Params: { shop: string }; Body: OrderBody }>(
  "/shops/:shop/checked-orders",
  { attachValidation: true, schema: { body: order, response: { 200: receipt } } },
  async (request, reply) => {
    if (!request.validationError) {
      const made = placeTypedOrder(request.params.shop, request.body);
      if (made) return made;
    }
    return reply.code(400).send(invalidOrder);
  },
);

app.get<{ Params: { id: string } }>(
  "/async/:id",
  {
    schema: {
      response: {
        200: { type: "object", properties: { id: integer, name: string, orders: integer, totalCents: integer } },
      },
    },
  },
  async (request) => summarize(Number(request.params.id)),
);

app.get("/stream", (request, reply) => {
  reply.type("text/csv").send(Readable.from(exportProducts()));
});

await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
console.log("listening", (app.server.address() as AddressInfo).port);
