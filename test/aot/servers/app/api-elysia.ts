import { Elysia } from "elysia";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask } from "./api-store";

let served = 0;

const app = new Elysia()
  .derive(({ request, set }) => {
    const requestId = request.headers.get("x-request-id") ?? `local-${++served}`;
    set.headers["x-request-id"] = requestId;
    return { requestId };
  })
  .onRequest(({ set }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["cache-control"] = "no-store";
  })
  .onError(({ error, code, request, set, status }) => {
    const requestId = request.headers.get("x-request-id") ?? `local-${served}`;
    set.headers["x-request-id"] = requestId;
    if (code === "NOT_FOUND") return status(404, { error: "not found", requestId } satisfies Failure);
    if (code === "PARSE") return status(400, { error: "bad body", requestId } satisfies Failure);
    return status(error instanceof ApiError ? error.status : 500, { error: (error as Error).message, requestId } satisfies Failure);
  })
  .get("/health", () => "ok")
  .group("/api", api =>
    api
      .derive(({ request }) => {
        const authorization = request.headers.get("authorization");
        if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
        const user = findUserByToken(authorization.slice(7));
        if (!user) throw new ApiError(401, "unknown token");
        return { user };
      })
      .get("/projects/:projectId/tasks/:taskId", ({ params }) => loadTask(parseId(params.projectId), parseId(params.taskId)))
      .get("/projects/:projectId/tasks", ({ user, params, query }) => loadTaskPage(user, parseId(params.projectId), query.status, query.limit))
      .post("/projects/:projectId/tasks", ({ user, params, body, status }) => status(201, createTask(user, parseId(params.projectId), body as NewTask))),
  )
  .listen({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });

console.log("listening", app.server?.port);
