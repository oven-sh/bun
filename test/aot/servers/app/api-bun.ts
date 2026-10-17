import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

let served = 0;

function requestIdOf(request: Request): string {
  return request.headers.get("x-request-id") ?? `local-${++served}`;
}

function authenticate(request: Request): User {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  return user;
}

function headersFor(requestId: string): Record<string, string> {
  return { "x-content-type-options": "nosniff", "cache-control": "no-store", "x-request-id": requestId };
}

function fail(error: unknown, requestId: string): Response {
  if (!(error instanceof Error)) throw error;
  const failure: Failure = { error: error.message, requestId };
  return Response.json(failure, { status: error instanceof ApiError ? error.status : 500, headers: headersFor(requestId) });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/health": (request) => new Response("ok", { headers: headersFor(requestIdOf(request)) }),
    "/api/projects/:projectId/tasks/:taskId": (request) => {
      const requestId = requestIdOf(request);
      try {
        authenticate(request);
        return Response.json(loadTask(parseId(request.params.projectId), parseId(request.params.taskId)), { headers: headersFor(requestId) });
      } catch (error) {
        return fail(error, requestId);
      }
    },
    "/api/projects/:projectId/tasks": {
      GET: (request) => {
        const requestId = requestIdOf(request);
        try {
          const user = authenticate(request);
          const query = new URL(request.url).searchParams;
          return Response.json(loadTaskPage(user, parseId(request.params.projectId), query.get("status"), query.get("limit")), { headers: headersFor(requestId) });
        } catch (error) {
          return fail(error, requestId);
        }
      },
      POST: async (request) => {
        const requestId = requestIdOf(request);
        try {
          const user = authenticate(request);
          let task: NewTask;
          try {
            task = (await request.json()) as NewTask;
          } catch {
            throw new ApiError(400, "bad body");
          }
          return Response.json(createTask(user, parseId(request.params.projectId), task), { status: 201, headers: headersFor(requestId) });
        } catch (error) {
          return fail(error, requestId);
        }
      },
    },
  },
  fetch(request) {
    const requestId = requestIdOf(request);
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) authenticate(request);
    } catch (error) {
      return fail(error, requestId);
    }
    const failure: Failure = { error: "not found", requestId };
    return Response.json(failure, { status: 404, headers: headersFor(requestId) });
  },
});

console.log("listening", server.port);
