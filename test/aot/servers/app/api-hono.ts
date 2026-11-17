import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

type Env = { Variables: { requestId: string; user: User } };

let served = 0;

const assignRequestId = createMiddleware<Env>(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? `local-${++served}`;
  c.set("requestId", requestId);
  await next();
  c.header("x-request-id", requestId);
});

const setSecurityHeaders = createMiddleware<Env>(async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
});

const authenticate = createMiddleware<Env>(async (c, next) => {
  const authorization = c.req.header("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  c.set("user", user);
  await next();
});

const app = new Hono<Env>();

app.use("*", assignRequestId);
app.use("*", setSecurityHeaders);
app.use("/api/*", authenticate);

app.get("/health", (c) => c.text("ok"));

app.get("/api/projects/:projectId/tasks/:taskId", (c) =>
  c.json(loadTask(parseId(c.req.param("projectId")), parseId(c.req.param("taskId")))),
);

app.get("/api/projects/:projectId/tasks", (c) =>
  c.json(loadTaskPage(c.get("user"), parseId(c.req.param("projectId")), c.req.query("status"), c.req.query("limit"))),
);

app.post("/api/projects/:projectId/tasks", async (c) => {
  let task: NewTask;
  try {
    task = (await c.req.json()) as NewTask;
  } catch {
    throw new ApiError(400, "bad body");
  }
  return c.json(createTask(c.get("user"), parseId(c.req.param("projectId")), task), 201);
});

app.notFound((c) => {
  const failure: Failure = { error: "not found", requestId: c.get("requestId") };
  return c.json(failure, 404);
});

app.onError((error, c) => {
  const failure: Failure = { error: error.message, requestId: c.get("requestId") };
  return c.json(failure, error instanceof ApiError ? error.status : 500);
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
});

console.log("listening", server.port);
