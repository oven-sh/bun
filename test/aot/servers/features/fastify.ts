import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

declare module "fastify" {
  interface FastifyRequest {
    visitor: string;
  }
}

const app = Fastify();

app.decorateRequest("visitor", "");

app.addHook("onRequest", async (request, reply) => {
  request.visitor = request.headers["x-user"]?.toString() ?? "nobody";
  reply.header("x-on-request", request.method);
});

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("x-payload", typeof payload);
  return payload;
});

app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown[] }, request, reply) => {
  reply.code(error.statusCode ?? 500).send({ handled: error.name, message: error.message, invalid: error.validation?.length ?? 0 });
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ missing: request.url, by: request.visitor });
});

app.post<{ Body: { name: string; tags: string[]; price: number } }>(
  "/items",
  {
    schema: {
      body: {
        type: "object",
        required: ["name", "price"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 20 },
          tags: { type: "array", items: { type: "string" }, default: [] },
          price: { type: "number", minimum: 0 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, cents: { type: "integer" } },
        },
      },
    },
  },
  async (request, reply) => {
    const { name, tags, price } = request.body;
    reply.code(201);
    return { name, tags, cents: Math.round(price * 100), secret: "left out by the response schema" };
  },
);

app.get<{ Querystring: { limit: number; exact: boolean; words: string[] } }>(
  "/search",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          exact: { type: "boolean", default: false },
          words: { type: "array", items: { type: "string" }, default: [] },
        },
      },
    },
  },
  async request => ({ ...request.query, kinds: [typeof request.query.limit, typeof request.query.exact, Array.isArray(request.query.words)] }),
);

app.get("/throws", async () => {
  throw new RangeError("out of range");
});

app.get("/teapot", async () => {
  throw Object.assign(new Error("short and stout"), { statusCode: 418 });
});

app.get("/moved", (request, reply) => {
  reply.redirect("/search?limit=3", 301);
});

app.get("/nothing-to-say", async (request, reply) => {
  reply.code(204);
});

app.get("/who", async request => ({ by: request.visitor, agent: request.headers["user-agent"] ?? null }));

app.addContentTypeParser("text/plain", { parseAs: "string" }, (request, body, done) => {
  done(null, String(body).toUpperCase());
});

app.post("/shout", async request => ({ heard: request.body }));

app.register(
  async (scoped: FastifyInstance) => {
    scoped.addHook("preHandler", async (request, reply) => {
      reply.header("x-scope", "v1");
    });
    scoped.get<{ Params: { id: string } }>("/things/:id", async request => ({ id: request.params.id, scope: "v1" }));
    scoped.get("/things/*", async request => ({ rest: (request.params as Record<string, string>)["*"] }));
  },
  { prefix: "/v1" },
);

await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
console.log("listening", (app.server.address() as AddressInfo).port);
