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

const syncRoute = `routes: {
    "/": (req, server) => {
      server.upgrade(req, { data: {} });
      throw new Error("throw-after-upgrade");
    },
  },`;

// The promise is still pending when on_response() inspects it, so the rejection
// is consumed by Bun's own reaction and never reaches the unhandled-rejection
// reporter. Bun.sleep() parks the continuation on a macrotask, past the
// microtask drain; the test waits on the websocket, not on the clock.
const deferredRoute = `routes: {
    "/": async (req, server) => {
      await Bun.sleep(1);
      server.upgrade(req, { data: {} });
      throw new Error("throw-after-upgrade");
    },
  },`;

const syncFetch = `fetch(req, server) {
    server.upgrade(req, { data: {} });
    throw new Error("throw-after-upgrade");
  },`;

test.each([
  ["routes handler, sync throw", syncRoute],
  ["routes handler, upgrade after await", deferredRoute],
  ["fetch handler, sync throw", syncFetch],
])("Bun.serve() reports a %s that throws after server.upgrade()", async (_name, handler) => {
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
  expect(stderr).toContain("error: throw-after-upgrade");
  expect(exitCode).toBe(1);
});

// `origin` tells the two shapes apart: a synchronous throw is an
// uncaughtException, a rejected handler promise keeps the unhandledRejection
// origin it would have had if Bun had not consumed the rejection itself.
test.each([
  ["sync throw", syncRoute, "uncaughtException"],
  ["upgrade after await", deferredRoute, "unhandledRejection"],
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
