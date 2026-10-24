import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug } from "harness";
import path from "node:path";
import { RawHttpConnection, get, post } from "./raw-http-client";

// The node:http server has a fast path for dispatching a request, a compact form for response headers and a finish that
// takes a single process.nextTick(). This pins how many requests of ordinary applications take each of them, so that a
// change which quietly pushes a framework onto the slow path fails here. The fixture tells them apart by internal names
// (the dispatchUsualRequest frame, the kOutHeaders symbol, the finishExchange tick): renaming one means updating it.

const fixture = path.join(import.meta.dir, "node-http-fast-path-coverage-fixture.ts");
const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;

const requests = [
  get("/text"),
  get("/json"),
  get("/users/7"),
  get("/redirect"),
  get("/missing"),
  post("/echo", '{"a":1}', "Content-Type: application/json\r\n"),
];

async function measure(stack: string) {
  await using server = Bun.spawn({
    cmd: [bunExe(), fixture, stack],
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
  return JSON.parse(stdout);
}

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

describe.concurrent("requests on a keep-alive connection take the fast path", () => {
  test.each([
    ["node:http", { ...everyRoute, "POST /echo": finishesInSeveralTicks }],
    ["express", { ...everyRoute, "GET /missing": finishesInSeveralTicks, "POST /echo": finishesInSeveralTicks }],
    [
      "express with middleware",
      { ...everyRoute, "GET /missing": finishesInSeveralTicks, "POST /echo": finishesInSeveralTicks },
    ],
    ["fastify", { ...everyRoute, "POST /echo": { ...usual, singleTickFinish: 10 } }],
  ])(
    "%s",
    async (stack, expected) => {
      expect(await measure(stack)).toEqual(expected);
    },
    timeout,
  );
});
