import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
  await using dir = tempDir("propagate-errors", {
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

// After server.upgrade() the server has no response left for error() to send,
// but the handler is still running. What it throws after that is reported as
// an uncaught exception, like a throw in a websocket callback. A rejection of
// its promise is reported as an unhandled one with the handler's own promise,
// also when the server subscribed to that promise before the upgrade (for a
// handler that upgrades before it returns, see websocket-server.test.ts).
// A rejection that follows a client abort stays dropped.
describe.concurrent("a handler that fails after server.upgrade()", () => {
  const listeners = `
    process.on("uncaughtException", (e, origin) => {
      console.log("uncaughtException:", String(e?.message ?? e), "| origin:", origin);
    });
    process.on("unhandledRejection", (e, promise) => {
      console.log("unhandledRejection:", e.message, "| the handler's promise:", promise === globalThis.handlerPromise);
    });`;
  const errorHook = `error(e) { console.log("error() saw:", e.message); },`;
  // The macrotask keeps the promise pending past the dispatch, so the server subscribes to it.
  const afterDispatch = `const afterDispatch = () => new Promise(resolve => setImmediate(resolve));`;

  async function runChild(source: string) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdoutLines: stdout.trim().split("\n").sort(), stderr, exitCode };
  }

  function upgradeChild(handlers: string, prelude = listeners) {
    return runChild(
      `${prelude}
       ${afterDispatch}
       const server = Bun.serve({
         port: 0,
         ${handlers}
         websocket: {
           open(ws) { ws.send("hi"); },
           message() {},
         },
       });
       const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
       ws.onerror = () => { console.log("ws error"); process.exit(1); };
       ws.onmessage = e => { console.log("ws got:", e.data); ws.close(); };
       ws.onclose = () => server.stop(true);`,
    );
  }

  const syncThrow = `fetch(req, srv) { srv.upgrade(req); throw new Error("E"); }, ${errorHook}`;
  const rejectionAfterAwait = `
    fetch(req, srv) {
      return (globalThis.handlerPromise = (async () => {
        await afterDispatch();
        srv.upgrade(req);
        throw new Error("E");
      })());
    },
    ${errorHook}`;

  test.each([
    ["fetch() throws", syncThrow, "E"],
    ["a route throws", `routes: { "/": (req, srv) => { srv.upgrade(req); throw new Error("E"); } }, ${errorHook}`, "E"],
    ["fetch() throws undefined", `fetch(req, srv) { srv.upgrade(req); throw undefined; }, ${errorHook}`, "undefined"],
    [
      "error() upgrades and throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       error(err) { server.upgrade(err.req); throw new Error("E"); },`,
      "E",
    ],
  ])("reports a throw to uncaughtException when %s", async (_, handlers, message) => {
    expect(await upgradeChild(handlers)).toEqual({
      stdoutLines: [`uncaughtException: ${message} | origin: uncaughtException`, "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["fetch() awaits, upgrades and throws", rejectionAfterAwait],
    [
      "fetch() returns a promise that rejects, then upgrades in the same task",
      `fetch(req, srv) {
         return (globalThis.handlerPromise = new Promise((resolve, reject) => {
           setImmediate(() => { reject(new Error("E")); srv.upgrade(req); });
         }));
       },
       ${errorHook}`,
    ],
    [
      "error() awaits, upgrades and throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       error(err) {
         return (globalThis.handlerPromise = (async () => {
           await afterDispatch();
           server.upgrade(err.req);
           throw new Error("E");
         })());
       },`,
    ],
  ])("reports a rejection to unhandledRejection when %s", async (_, handlers) => {
    expect(await upgradeChild(handlers)).toEqual({
      stdoutLines: ["unhandledRejection: E | the handler's promise: true", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    [
      "the program handles the handler's promise itself",
      `fetch(req, srv) {
         const promise = (async () => { await afterDispatch(); srv.upgrade(req); throw new Error("E"); })();
         promise.catch(() => {});
         return promise;
       },
       ${errorHook}`,
    ],
    [
      "the handler returns a Response after the upgrade",
      `async fetch(req, srv) { await afterDispatch(); srv.upgrade(req); return new Response("unused"); }, ${errorHook}`,
    ],
  ])("reports nothing when %s", async (_, handlers) => {
    expect(await upgradeChild(handlers)).toEqual({ stdoutLines: ["ws got: hi"], stderr: "", exitCode: 0 });
  });

  // Like any uncaught exception or unhandled rejection, it ends the process.
  test.each([
    ["a throw", syncThrow],
    ["a rejection", rejectionAfterAwait],
  ])("with no listener, prints %s and exits with code 1", async (_, handlers) => {
    const { stderr, exitCode } = await upgradeChild(handlers, "");
    expect(stderr).toContain("error: E\n");
    expect(exitCode).toBe(1);
  });

  test("drops a rejection that follows a client abort", async () => {
    const result = await runChild(
      `${listeners}
       const received = Promise.withResolvers();
       const aborted = Promise.withResolvers();
       const server = Bun.serve({
         port: 0,
         ${errorHook}
         async fetch(req) {
           req.signal.addEventListener("abort", aborted.resolve);
           received.resolve();
           await aborted.promise;
           throw new Error("E");
         },
       });
       const controller = new AbortController();
       const request = fetch(server.url, { signal: controller.signal }).catch(e => e.name);
       await received.promise;
       controller.abort();
       console.log("client:", await request);
       await aborted.promise;
       await new Promise(resolve => setImmediate(resolve));
       server.stop(true);
       console.log("done");`,
    );
    expect(result).toEqual({ stdoutLines: ["client: AbortError", "done"], stderr: "", exitCode: 0 });
  });
});
