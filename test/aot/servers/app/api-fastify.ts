import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    user: User | undefined;
  }
}

let served = 0;

const app = Fastify();

app.decorateRequest("requestId", "");
app.decorateRequest("user", undefined);

app.addHook("onRequest", async (request, reply) => {
  const given = request.headers["x-request-id"];
  request.requestId = typeof given === "string" ? given : `local-${++served}`;
  reply.header("x-request-id", request.requestId);
});

app.addHook("onRequest", async (request, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("cache-control", "no-store");
});

app.addHook("onRequest", async request => {
  if (!request.url.startsWith("/api/")) return;
  const authorization = request.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  request.user = user;
});

app.get("/health", async () => "ok");

app.get<{ Params: { projectId: string; taskId: string } }>("/api/projects/:projectId/tasks/:taskId", async request =>
  loadTask(parseId(request.params.projectId), parseId(request.params.taskId)),
);

app.get<{ Params: { projectId: string }; Querystring: { status?: string; limit?: string } }>("/api/projects/:projectId/tasks", async request =>
  loadTaskPage(request.user!, parseId(request.params.projectId), request.query.status, request.query.limit),
);

app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/tasks", async (request, reply) => {
  reply.status(201);
  return createTask(request.user!, parseId(request.params.projectId), request.body as NewTask);
});

app.setNotFoundHandler((request, reply) => {
  const failure: Failure = { error: "not found", requestId: request.requestId };
  reply.status(404).send(failure);
});

app.setErrorHandler((error: Error, request, reply) => {
  const isBadBody = error instanceof SyntaxError || (error as { code?: string }).code?.startsWith("FST_ERR_CTP");
  const failure: Failure = { error: isBadBody ? "bad body" : error.message, requestId: request.requestId };
  reply.status(error instanceof ApiError ? error.status : isBadBody ? 400 : 500).send(failure);
});

await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
console.log("listening", (app.server.address() as AddressInfo).port);
