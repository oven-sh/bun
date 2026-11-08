import { App, type Middleware } from "./thin-framework";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

type Variables = { requestId: string; user: User };

let served = 0;

const assignRequestId: Middleware<Variables> = async (c, next) => {
  const requestId = c.requestHeader("x-request-id") ?? `local-${++served}`;
  c.set("requestId", requestId);
  await next();
  c.header("x-request-id", requestId);
};

const setSecurityHeaders: Middleware<Variables> = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
};

const authenticate: Middleware<Variables> = async (c, next) => {
  const authorization = c.requestHeader("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  c.set("user", user);
  await next();
};

const app = new App<Variables>();

app.use("/", assignRequestId);
app.use("/", setSecurityHeaders);
app.use("/api/", authenticate);

app.on("GET", "/health", (c) => c.text("ok"));

app.on("GET", "/api/projects/:projectId/tasks/:taskId", (c) => c.json(loadTask(parseId(c.param("projectId")), parseId(c.param("taskId")))));

app.on("GET", "/api/projects/:projectId/tasks", (c) => c.json(loadTaskPage(c.get("user"), parseId(c.param("projectId")), c.query("status"), c.query("limit"))));

app.on("POST", "/api/projects/:projectId/tasks", async (c) => {
  let task: NewTask;
  try {
    task = (await c.request.json()) as NewTask;
  } catch {
    throw new ApiError(400, "bad body");
  }
  c.json(createTask(c.get("user"), parseId(c.param("projectId")), task), 201);
});

app.notFound((c) => {
  const failure: Failure = { error: "not found", requestId: c.get("requestId") };
  c.json(failure, 404);
});

app.onError((error, c) => {
  const failure: Failure = { error: error.message, requestId: c.get("requestId") };
  c.json(failure, error instanceof ApiError ? error.status : 500);
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: app.routes,
  fetch: app.fetch,
});

console.log("listening", server.port);
