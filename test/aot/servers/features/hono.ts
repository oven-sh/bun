import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { validator } from "hono/validator";

const app = new Hono<{ Variables: { visitor: string } }>();

app.use("*", async (c, next) => {
  c.set("visitor", c.req.header("x-user") ?? "nobody");
  await next();
  c.header("x-after", String(c.res.status));
});
app.use("/open/*", cors({ origin: ["https://example.com"], allowMethods: ["GET", "POST"], maxAge: 600 }));
app.use("/safe/*", secureHeaders());
app.use("/tagged/*", etag());
app.use("/private/*", basicAuth({ username: "bun", password: "hunter2" }));

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  return c.json({ handled: error.name, message: error.message }, 500);
});
app.notFound(c => c.json({ missing: c.req.path, by: c.get("visitor") }, 404));

app.get("/open/data", c => c.json({ open: true }));
app.get("/safe/data", c => c.json({ safe: true }));
app.get("/tagged/data", c => c.text("the same text every time"));
app.get("/private/data", c => c.text("let in"));
app.get("/throws", () => {
  throw new RangeError("out of range");
});
app.get("/teapot", () => {
  throw new HTTPException(418, { message: "short and stout" });
});
app.get("/moved", c => c.redirect("/open/data", 301));
app.get("/page", c => c.html("<h1>Hello</h1>"));
app.get("/nothing-to-say", c => c.body(null, 204));
app.get("/visits", c => {
  const visits = Number(getCookie(c, "visits") ?? 0) + 1;
  setCookie(c, "visits", String(visits), { httpOnly: true, path: "/", maxAge: 60, sameSite: "Lax" });
  return c.json({ visits });
});
app.get("/queries", c => c.json({ all: c.req.queries("tag") ?? [], one: c.req.query("tag") ?? null, every: c.req.query() }));
app.get("/files/:name{[a-z]+\\.txt}", c => c.text(c.req.param("name")));
app.get("/optional/:kind?", c => c.json({ kind: c.req.param("kind") ?? null }));
app.get("/rest/*", c => c.text(c.req.path));
app.post(
  "/items",
  validator("json", (value: Record<string, unknown>, c) => {
    if (typeof value.name !== "string" || value.name.length === 0) return c.json({ invalid: "name" }, 422);
    return { name: value.name, tags: Array.isArray(value.tags) ? value.tags.map(String) : [] };
  }),
  c => c.json(c.req.valid("json"), 201),
);
app.post("/form", async c => c.json(await c.req.parseBody({ all: true })));

const scoped = new Hono().basePath("/things");
scoped.get("/:id", c => c.json({ id: c.req.param("id"), scope: "v1" }));
app.route("/v1", scoped);

const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
console.log("listening", server.port);
