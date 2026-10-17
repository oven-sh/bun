import { Elysia, t } from "elysia";

class OutOfStock extends Error {
  constructor(public sku: string) {
    super(`no ${sku} left`);
  }
}

const things = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(({ set }) => {
    set.headers["x-scope"] = "v1";
  })
  .get("/things/:id", ({ params }) => ({ id: params.id, scope: "v1" }), { params: t.Object({ id: t.Numeric() }) })
  .get("/things/*", ({ params }) => ({ rest: params["*"] }));

const app = new Elysia()
  .state("served", 0)
  .decorate("shop", "west")
  .error({ OutOfStock })
  .derive(({ headers }) => ({ visitor: headers["x-user"] ?? "nobody" }))
  .onError(({ code, error, status }) => {
    if (code === "OutOfStock") return status(409, { handled: code, sku: error.sku });
    if (code === "VALIDATION") return status(422, { handled: code, on: error.type });
    if (code === "NOT_FOUND") return status(404, { handled: code });
    return status(500, { handled: String(code), message: error instanceof Error ? error.message : String(error) });
  })
  .onAfterHandle(({ set, store }) => {
    set.headers["x-served"] = String(++store.served);
  })
  .use(things)
  .post("/items", ({ body, status }) => status(201, { ...body, cents: Math.round(body.price * 100) }), {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 20 }),
      tags: t.Array(t.String(), { default: [] }),
      price: t.Number({ minimum: 0 }),
    }),
  })
  .get("/search", ({ query }) => ({ ...query, kinds: [typeof query.limit, typeof query.exact] }), {
    query: t.Object({ limit: t.Numeric({ minimum: 1, maximum: 50, default: 10 }), exact: t.BooleanString({ default: false }) }),
  })
  .get("/throws", () => {
    throw new RangeError("out of range");
  })
  .get("/sold-out", () => {
    throw new OutOfStock("SKU-1");
  })
  .get("/moved", ({ redirect }) => redirect("/search?limit=3", 301))
  .get("/who", ({ visitor, shop }) => ({ by: visitor, shop }))
  .get("/visits", ({ cookie }) => {
    const visits = cookie.visits!;
    visits.value = Number(visits.value ?? 0) + 1;
    visits.httpOnly = true;
    return { visits: visits.value };
  })
  .guard({ headers: t.Object({ authorization: t.String() }) }, guarded => guarded.get("/private", ({ headers }) => headers.authorization.length))
  .get("/numbers", function* () {
    for (let n = 0; n < 5; n++) yield `${n}\n`;
  })
  .listen({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });

console.log("listening", app.server?.port);
