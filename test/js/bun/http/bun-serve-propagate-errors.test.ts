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

test("Bun.serve() propagates an error thrown after server.upgrade() to the parent", async () => {
  const code = `import { test } from "bun:test";

test("a handler that throws after server.upgrade()", async () => {
  const server = Bun.serve({
    development: false,
    port: 0,
    fetch(req, server) {
      server.upgrade(req);
      throw new Error("Test failed successfully");
    },
    websocket: {
      open(ws) {
        ws.close();
      },
      message() {},
    },
  });
  const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
  await new Promise(resolve => (ws.onclose = resolve));
  server.stop(true);
});
`;
  await using dir = tempDir("propagate-errors-upgrade", {
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

  expect(stderr.toString()).toContain("error: Test failed successfully");
  expect(exitCode).toBe(1);
});

// After server.upgrade() there is no response left to send, but the handler is still running. What
// it throws, or rejects with when the server had subscribed to its promise before the upgrade, used
// to vanish. It goes where any error of a handler goes: to error() (whose Response is dropped), or
// to stderr, and the server keeps serving. (For a handler that upgrades before it returns a promise,
// see websocket-server.test.ts.)
describe.concurrent("a handler that fails after server.upgrade()", () => {
  const listeners = `
    process.on("uncaughtException", e => console.log("uncaughtException:", String(e?.message ?? e)));
    process.on("unhandledRejection", e => console.log("unhandledRejection:", String(e?.message ?? e)));`;
  const errorHook = `error(e) { console.log("error() saw:", e.message); return new Response("dropped"); },`;
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

  function upgradeChild(handlers: string, development = false) {
    return runChild(
      `${listeners}
       ${afterDispatch}
       const server = Bun.serve({
         port: 0,
         development: ${development},
         ${handlers}
         websocket: {
           // The client answers, and only then closes: by then the handler has failed.
           open(ws) { ws.send("hi"); },
           message(ws) { ws.close(); },
         },
       });
       const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
       ws.onerror = () => { console.log("ws error"); process.exit(1); };
       ws.onmessage = async e => { await afterDispatch(); await afterDispatch(); console.log("ws got:", e.data); ws.send("bye"); };
       ws.onclose = () => { console.log("pendingRequests:", server.pendingRequests); server.stop(true); };`,
    );
  }

  const syncThrow = `fetch(req, srv) { srv.upgrade(req); throw new Error("E"); },`;
  const rejectionAfterAwait = `async fetch(req, srv) { await afterDispatch(); srv.upgrade(req); throw new Error("E"); },`;

  test.each([
    ["fetch() throws", syncThrow],
    ["a route throws", `routes: { "/": (req, srv) => { srv.upgrade(req); throw new Error("E"); } },`],
    ["fetch() awaits, upgrades and throws", rejectionAfterAwait],
    [
      "fetch() returns a promise that rejects, then upgrades in the same task",
      `fetch(req, srv) {
         return new Promise((resolve, reject) => {
           setImmediate(() => { reject(new Error("E")); srv.upgrade(req); });
         });
       },`,
    ],
    [
      "fetch() awaits, upgrades and throws, and the program catches the same promise",
      `fetch(req, srv) {
         const promise = (async () => { await afterDispatch(); srv.upgrade(req); throw new Error("E"); })();
         promise.catch(() => {});
         return promise;
       },`,
    ],
  ])("error() gets it when %s", async (_, handlers) => {
    expect(await upgradeChild(handlers + errorHook)).toEqual({
      stdoutLines: ["error() saw: E", "pendingRequests: 0", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["fetch() throws and there is no error()", syncThrow, false],
    ["fetch() throws and there is no error(), in development", syncThrow, true],
    ["fetch() awaits, upgrades and throws and there is no error()", rejectionAfterAwait, false],
    ["fetch() awaits, upgrades and throws and there is no error(), in development", rejectionAfterAwait, true],
    [
      "error() upgrades and throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       error(err) { server.upgrade(err.req); throw new Error("E"); },`,
      false,
    ],
    [
      "error() awaits, upgrades and throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       async error(err) { await afterDispatch(); server.upgrade(err.req); throw new Error("E"); },`,
      false,
    ],
  ])("it is printed and the server keeps serving when %s", async (_, handlers, development) => {
    const { stdoutLines, stderr, exitCode } = await upgradeChild(handlers, development);
    expect(stderr).toContain("error: E\n");
    // The process runs to its natural end. Its exit code is then 1, as after any error of a handler that was printed.
    expect({ stdoutLines, exitCode }).toEqual({ stdoutLines: ["pendingRequests: 0", "ws got: hi"], exitCode: 1 });
  });

  test("nothing is reported when the handler returns a Response after the upgrade", async () => {
    const handlers = `async fetch(req, srv) { await afterDispatch(); srv.upgrade(req); return new Response("unused"); },`;
    expect(await upgradeChild(handlers + errorHook)).toEqual({
      stdoutLines: ["pendingRequests: 0", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("a rejection that follows a client abort stays dropped", async () => {
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

  // server.upgrade() answers an unsupported Sec-WebSocket-Version itself and returns false.
  test("a throw that follows a 426 from server.upgrade() stays dropped", async () => {
    const result = await runChild(
      `${listeners}
       const server = Bun.serve({
         port: 0,
         hostname: "127.0.0.1",
         ${errorHook}
         fetch(req, srv) {
           if (srv.upgrade(req)) return;
           throw new Error("E");
         },
         websocket: { message() {} },
       });
       await Bun.connect({
         hostname: "127.0.0.1",
         port: server.port,
         socket: {
           open(socket) {
             socket.write(
               "GET / HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
                 "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 12\\r\\n\\r\\n",
             );
           },
           data(socket, data) {
             console.log("client got:", data.toString().split("\\r\\n")[0]);
             socket.end();
             server.stop(true);
           },
         },
       });`,
    );
    expect(result).toEqual({
      stdoutLines: ["client got: HTTP/1.1 426 Upgrade Required"],
      stderr: "",
      exitCode: 0,
    });
  });
});
