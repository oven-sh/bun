import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import Koa from "koa";
import type { AddressInfo } from "node:net";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

let served = 0;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const assignRequestId: Koa.Middleware = async (ctx, next) => {
  const requestId = ctx.get("x-request-id") || `local-${++served}`;
  ctx.state.requestId = requestId;
  await next();
  ctx.set("x-request-id", requestId);
};

const setSecurityHeaders: Koa.Middleware = async (ctx, next) => {
  await next();
  ctx.set("x-content-type-options", "nosniff");
  ctx.set("cache-control", "no-store");
};

const answerFailures: Koa.Middleware = async (ctx, next) => {
  try {
    await next();
    if (ctx.status !== 404 || ctx.body != null) return;
    const failure: Failure = { error: "not found", requestId: ctx.state.requestId as string };
    ctx.status = 404;
    ctx.body = failure;
  } catch (error) {
    const failure: Failure = { error: (error as Error).message, requestId: ctx.state.requestId as string };
    ctx.status = error instanceof ApiError ? error.status : 500;
    ctx.body = failure;
  }
};

const authenticate: Koa.Middleware = async (ctx, next) => {
  const authorization = ctx.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  ctx.state.user = user;
  await next();
};

const app = new Koa();
const router = new Router();

router.get("/health", ctx => {
  ctx.body = "ok";
});

router.get("/api/projects/:projectId/tasks/:taskId", authenticate, ctx => {
  ctx.body = loadTask(parseId(ctx.params.projectId), parseId(ctx.params.taskId));
});

router.get("/api/projects/:projectId/tasks", authenticate, ctx => {
  ctx.body = loadTaskPage(ctx.state.user as User, parseId(ctx.params.projectId), text(ctx.query.status), text(ctx.query.limit));
});

router.post("/api/projects/:projectId/tasks", authenticate, async (ctx, next) => {
  try {
    await bodyParser()(ctx, next);
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(400, "bad body");
  }
}, ctx => {
  ctx.status = 201;
  ctx.body = createTask(ctx.state.user as User, parseId(ctx.params.projectId), ctx.request.body as NewTask);
});

app.use(assignRequestId).use(setSecurityHeaders).use(answerFailures).use(router.routes());

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});
