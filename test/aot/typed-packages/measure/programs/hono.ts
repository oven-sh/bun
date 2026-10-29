import { Hono } from "hono";
import { run } from "../turns";

interface Item {
  id: number;
  name: string;
  cents: number;
}

const items: Item[] = Array.from({ length: 50 }, (_, id) => ({ id, name: `item ${id}`, cents: 199 + 35 * id }));

const app = new Hono<{ Variables: { requestId: string; user: string | undefined } }>();
let served = 0;

app.use("*", async (c, next) => {
  c.set("requestId", `r-${served++ % 1000}`);
  await next();
  c.header("x-request-id", c.get("requestId"));
});
app.use("/api/*", async (c, next) => {
  c.set("user", c.req.header("authorization")?.slice(7));
  await next();
});
app.get("/", c => c.text("hello"));
app.get("/api/items", c => c.json({ items: items.slice(0, Number(c.req.query("limit") ?? 10)), user: c.get("user") }));
app.get("/api/items/:id", c => {
  const item = items[Number(c.req.param("id"))];
  return item ? c.json(item) : c.json({ error: "not found" }, 404);
});
app.get("/api/shops/:shop/items/:id/reviews/:review", c => c.json(c.req.param()));
app.post("/api/items", async c => {
  const body = await c.req.json<Item>();
  return c.json({ id: items.length, name: body.name, cents: body.cents }, 201);
});
app.get("/page", c => c.html(`<!doctype html><title>${items.length} items</title><ul>${items.map(item => `<li>${item.name}</li>`).join("")}</ul>`));
app.notFound(c => c.text("nothing here", 404));

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
    const response = await app.fetch(request);
    answer += `${response.status} ${response.headers.get("x-request-id")} ${await response.text()}\n`;
  }
  return answer;
});
