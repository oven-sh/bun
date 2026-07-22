import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";

test("Bun.serve() propagates errors to the parent fixture", async () => {
  const code = `import { test } from "bun:test";

test("Bun.serve() propagates errors to the parent", async () => {
  const server = Bun.serve({
    development: false,
    port: 0,
    fetch(req) {
      throw new Error("Test failed successfully");
    },
  });
  await fetch(server.url);
  server.stop(true);
});
`;
  const dir = tempDirWithFiles("propagate-errors", {
    "package.json": JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: {},
    }),
    "index.test.ts": code,
  });

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test"],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
  });

  expect(exitCode).toBe(1);
  expect(stderr.toString()).toContain("error: Test failed successfully");
});

// server.upgrade() detaches the response, so nothing the handler does after it
// can reach error() or the client. The exception still has to be reported.
const afterUpgradeFixture = (handler: string, prelude = "") => `
${prelude}
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  ${handler}
  websocket: {
    open(ws) {
      ws.send("upgraded");
    },
    message() {},
    close() {},
  },
});

const { promise, resolve } = Promise.withResolvers();
const ws = new WebSocket(server.url.href.replace("http", "ws"));
ws.onmessage = e => resolve(String(e.data));
ws.onclose = () => resolve("closed-without-message");
ws.onerror = () => {};
const got = await promise;
ws.close();
console.log("ws:" + got);
server.stop(true);
`;

const thrown = `new Error("throw-after-upgrade")`;

const syncRoute = (value: string) => `routes: {
    "/": (req, server) => {
      server.upgrade(req, { data: {} });
      throw ${value};
    },
  },`;

// The promise is still pending when on_response() inspects it, so the rejection
// is consumed by Bun's own reaction and never reaches the unhandled-rejection
// reporter. Bun.sleep() parks the continuation on a macrotask, past the
// microtask drain; the test waits on the websocket, not on the clock.
const deferredRoute = (value: string) => `routes: {
    "/": async (req, server) => {
      await Bun.sleep(1);
      server.upgrade(req, { data: {} });
      throw ${value};
    },
  },`;

const syncFetch = (value: string) => `fetch(req, server) {
    server.upgrade(req, { data: {} });
    throw ${value};
  },`;

test.concurrent.each([
  ["routes handler, sync throw", syncRoute(thrown), "error: throw-after-upgrade"],
  ["routes handler, upgrade after await", deferredRoute(thrown), "error: throw-after-upgrade"],
  ["fetch handler, sync throw", syncFetch(thrown), "error: throw-after-upgrade"],
  // A nullish thrown value is still a thrown value, and the non-upgraded path
  // reports it, so these must not be filtered out on the way to the reporter.
  // (on_reject() normalizes a nullish rejection reason to undefined, so the
  // deferred shape cannot tell `throw null` from `throw undefined`.)
  ["routes handler, sync throw undefined", syncRoute("undefined"), "error: undefined"],
  ["routes handler, sync throw null", syncRoute("null"), "error: null"],
  ["routes handler, throw undefined after await", deferredRoute("undefined"), "error: undefined"],
])("Bun.serve() reports a %s after server.upgrade()", async (_name, handler, expected) => {
  using dir = tempDir("throw-after-upgrade", {
    "index.ts": afterUpgradeFixture(handler),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The socket was already handed to the WebSocket, so the upgrade still succeeds.
  expect(stdout).toBe("ws:upgraded\n");
  expect(stderr).toContain(expected);
  expect(exitCode).toBe(1);
});

// `origin` tells the two shapes apart: a synchronous throw is an
// uncaughtException, a rejected handler promise keeps the unhandledRejection
// origin it would have had if Bun had not consumed the rejection itself.
test.concurrent.each([
  ["sync throw", syncRoute(thrown), "uncaughtException"],
  ["upgrade after await", deferredRoute(thrown), "unhandledRejection"],
])("a %s after server.upgrade() reaches process.on('uncaughtException')", async (_name, handler, origin) => {
  using dir = tempDir("throw-after-upgrade-handler", {
    "index.ts": afterUpgradeFixture(
      handler,
      `process.on("uncaughtException", (err, origin) => {
         console.log("uncaughtException:" + err.message + ":" + origin);
       });`,
    ),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe(`uncaughtException:throw-after-upgrade:${origin}\nws:upgraded\n`);
  expect(stderr).not.toContain("throw-after-upgrade");
  expect(exitCode).toBe(0);
});
