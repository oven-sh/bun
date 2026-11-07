import { Elysia, t } from "elysia";
import { run } from "../turns";

interface Item {
  id: number;
  name: string;
  cents: number;
}

const items: Item[] = Array.from({ length: 50 }, (_, id) => ({ id, name: `item ${id}`, cents: 199 + 35 * id }));
let served = 0;

const app = new Elysia()
  .derive(({ headers }) => ({ user: headers.authorization?.slice(7), requestId: `r-${served++ % 1000}` }))
  .onAfterHandle(({ set, requestId }) => {
    set.headers["x-request-id"] = requestId;
  })
  .get("/", () => "hello")
  .get("/api/items", ({ query, user }) => ({ items: items.slice(0, query.limit), user }), { query: t.Object({ limit: t.Numeric({ default: 10 }) }) })
  .get(
    "/api/items/:id",
    ({ params, status }) => items[params.id] ?? status(404, { error: "not found" }),
    { params: t.Object({ id: t.Numeric() }) },
  )
  .get("/api/shops/:shop/items/:id/reviews/:review", ({ params }) => params)
  .post("/api/items", ({ body, set }) => {
    set.status = 201;
    return { id: items.length, name: body.name, cents: body.cents };
  }, { body: t.Object({ id: t.Number(), name: t.String(), cents: t.Number() }) })
  .get("/page", ({ set }) => {
    set.headers["content-type"] = "text/html";
    return `<!doctype html><title>${items.length} items</title><ul>${items.map(item => `<li>${item.name}</li>`).join("")}</ul>`;
  });

const headers = { authorization: "Bearer zoe", accept: "application/json" };
const requests = (): Request[] => [
  new Request("http://localhost/"),
  new Request("http://localhost/api/items?limit=20", { headers }),
  new Request("http://localhost/api/items/7", { headers }),
  new Request("http://localhost/api/items/700", { headers }),
  new Request("http://localhost/api/shops/west/items/12/reviews/3", { headers }),
  new Request("http://localhost/api/items", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"id":0,"name":"new","cents":5}' }),
  new Request("http://localhost/page"),
  new Request("http://localhost/missing"),
];

await run(async () => {
  served = 0;
  let answer = "";
  for (const request of requests()) {
    const response = await app.handle(request);
    answer += `${response.status} ${response.headers.get("x-request-id")} ${await response.text()}\n`;
  }
  return answer;
});
