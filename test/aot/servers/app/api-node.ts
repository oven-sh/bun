import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiError, createTask, findUserByToken, loadTask, loadTaskPage, parseId, type Failure, type NewTask, type User } from "./api-store";

interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  requestId: string;
  user: User | undefined;
}
type Next = () => Promise<void>;
type Middleware = (context: Context, next: Next) => Promise<void>;

let served = 0;

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const assignRequestId: Middleware = async (context, next) => {
  const given = context.req.headers["x-request-id"];
  context.requestId = typeof given === "string" ? given : `local-${++served}`;
  context.res.setHeader("x-request-id", context.requestId);
  await next();
};

const setSecurityHeaders: Middleware = async (context, next) => {
  context.res.setHeader("x-content-type-options", "nosniff");
  context.res.setHeader("cache-control", "no-store");
  await next();
};

const answerFailures: Middleware = async (context, next) => {
  try {
    await next();
  } catch (error) {
    const failure: Failure = { error: (error as Error).message, requestId: context.requestId };
    sendJson(context.res, error instanceof ApiError ? error.status : 500, failure);
  }
};

const authenticate: Middleware = async (context, next) => {
  if (context.url.pathname.startsWith("/api/")) {
    const authorization = context.req.headers.authorization;
    if (!authorization || !authorization.startsWith("Bearer ")) throw new ApiError(401, "missing token");
    const user = findUserByToken(authorization.slice(7));
    if (!user) throw new ApiError(401, "unknown token");
    context.user = user;
  }
  await next();
};

const route: Middleware = async ({ req, res, url, user, requestId }) => {
  const parts = url.pathname.split("/");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
    res.end("ok");
    return;
  }
  if (parts[1] === "api" && parts[2] === "projects" && parts[4] === "tasks") {
    if (req.method === "GET" && parts.length === 6) return sendJson(res, 200, loadTask(parseId(parts[3]!), parseId(parts[5]!)));
    if (req.method === "GET" && parts.length === 5)
      return sendJson(res, 200, loadTaskPage(user!, parseId(parts[3]!), url.searchParams.get("status"), url.searchParams.get("limit")));
    if (req.method === "POST" && parts.length === 5) {
      let task: NewTask;
      try {
        task = JSON.parse(await readBody(req)) as NewTask;
      } catch {
        throw new ApiError(400, "bad body");
      }
      return sendJson(res, 201, createTask(user!, parseId(parts[3]!), task));
    }
  }
  const failure: Failure = { error: "not found", requestId };
  sendJson(res, 404, failure);
};

const chain = [assignRequestId, setSecurityHeaders, answerFailures, authenticate, route];

function run(context: Context, index: number): Promise<void> {
  return chain[index]!(context, () => run(context, index + 1));
}

const server = createServer((req, res) => {
  void run({ req, res, url: new URL(req.url ?? "/", "http://127.0.0.1"), requestId: "", user: undefined }, 0);
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});
