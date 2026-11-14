import express from "express";
import type { AddressInfo } from "node:net";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

let served = 0;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const assignRequestId: express.Handler = (req, res, next) => {
  const requestId = req.get("x-request-id") ?? `local-${++served}`;
  res.locals.requestId = requestId;
  res.set("x-request-id", requestId);
  next();
};

const setSecurityHeaders: express.Handler = (req, res, next) => {
  res.set("x-content-type-options", "nosniff");
  res.set("cache-control", "no-store");
  next();
};

const authenticate: express.Handler = (req, res, next) => {
  const authorization = req.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
  const user = findUserByToken(authorization.slice(7));
  if (!user) throw new ApiError(401, "unknown token");
  res.locals.user = user;
  next();
};

const app = express();

app.use(assignRequestId);
app.use(setSecurityHeaders);
app.use("/api", authenticate);

app.get("/health", (req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/api/projects/:projectId/tasks/:taskId", (req, res) => {
  res.json(loadTask(parseId(req.params.projectId), parseId(req.params.taskId)));
});

app.get("/api/projects/:projectId/tasks", (req, res) => {
  res.json(loadTaskPage(res.locals.user as User, parseId(req.params.projectId), text(req.query.status), text(req.query.limit)));
});

app.post("/api/projects/:projectId/tasks", express.text({ type: "application/json" }), (req, res) => {
  let task: NewTask;
  try {
    task = JSON.parse(req.body as string) as NewTask;
  } catch {
    throw new ApiError(400, "bad body");
  }
  res.status(201).json(createTask(res.locals.user as User, parseId(req.params.projectId), task));
});

const answerNotFound: express.Handler = (req, res) => {
  const failure: Failure = { error: "not found", requestId: res.locals.requestId as string };
  res.status(404).json(failure);
};

const answerFailures: express.ErrorHandler = (error, req, res, next) => {
  const failure: Failure = { error: error.message, requestId: res.locals.requestId as string };
  res.status(error instanceof ApiError ? error.status : 500).json(failure);
};

app.use(answerNotFound);
app.use(answerFailures);

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});
