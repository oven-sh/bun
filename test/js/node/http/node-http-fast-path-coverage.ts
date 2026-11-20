import { bunEnv } from "harness";
import path from "node:path";
import { RawHttpConnection, get, post } from "./raw-http-client";

export const fixture = path.join(import.meta.dir, "node-http-fast-path-coverage-fixture.ts");

const requests = [
  get("/text"),
  get("/json"),
  get("/users/7"),
  get("/redirect"),
  get("/missing"),
  post("/echo", '{"a":1}', "Content-Type: application/json\r\n"),
];

/** Starts the fixture with `cmd`, sends each request ten times on a connection of its own and returns what the fixture counted. */
export async function measure(cmd: string[]) {
  await using server = Bun.spawn({
    cmd,
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (!stdout.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  const port = Number(stdout.slice(0, stdout.indexOf("\n")));
  stdout = stdout.slice(stdout.indexOf("\n") + 1);

  {
    using connection = await RawHttpConnection.connect(port);
    await connection.request(get("/text", "Connection: close\r\n"));
  }
  for (const request of requests) {
    using connection = await RawHttpConnection.connect(port);
    for (let i = 0; i < 10; i++) await connection.request(request);
  }

  server.stdin.end();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  return JSON.parse(stdout) as Coverage;
}

type Counts = { requests: number; fastDispatch: number; compactHeaders: number; singleTickFinish: number };
export type Coverage = Record<string, Counts>;

const usual = { requests: 10, fastDispatch: 10, compactHeaders: 10, singleTickFinish: 9 };
const everyRoute = {
  "GET /text": usual,
  "GET /json": usual,
  "GET /users/7": usual,
  "GET /redirect": usual,
  "GET /missing": usual,
  "POST /echo": usual,
};
const finishesInSeveralTicks = { ...usual, singleTickFinish: 0 };

/** What each stack of the fixture takes where the headers of every response stay in the compact form. */
export const stacks: [stack: string, expected: Coverage][] = [
  ["node:http", { ...everyRoute, "POST /echo": finishesInSeveralTicks }],
  ["express", { ...everyRoute, "GET /missing": finishesInSeveralTicks, "POST /echo": finishesInSeveralTicks }],
  [
    "express with middleware",
    { ...everyRoute, "GET /missing": finishesInSeveralTicks, "POST /echo": finishesInSeveralTicks },
  ],
  ["fastify", { ...everyRoute, "POST /echo": { ...usual, singleTickFinish: 10 } }],
];
