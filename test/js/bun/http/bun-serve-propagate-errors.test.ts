import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Runs `code` as a test file with `bun test`.
async function runBunTest(code: string) {
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
  return { stderr: stderr.toString(), exitCode };
}

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
  const { stderr, exitCode } = await runBunTest(code);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("error: Test failed successfully");
});

test("Bun.serve() propagates an error thrown after server.upgrade() to the parent", async () => {
  const code = `import { test } from "bun:test";

test("fetch() throws after server.upgrade()", async () => {
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
  const { stderr, exitCode } = await runBunTest(code);
  expect(stderr).toContain("error: Test failed successfully");
  expect(exitCode).toBe(1);
});

// After server.upgrade() there's no response left to send, but the handler keeps running. Errors it
// threw, or rejected with once the server had subscribed to its promise, used to be silently dropped.
// Now they're reported like any other handler error: passed to error() (its Response is ignored) or
// printed to stderr, and the server keeps serving. Handlers that upgrade before returning a promise
// are covered in websocket-server.test.ts.
describe.concurrent("handler errors after server.upgrade()", () => {
  const listeners = `
    process.on("uncaughtException", e => console.log("uncaughtException:", String(e?.message ?? e)));
    process.on("unhandledRejection", e => console.log("unhandledRejection:", String(e?.message ?? e)));`;
  const errorHandler = `error(e) { console.log("error() saw:", e.message); return new Response("dropped"); },`;
  // Keeps the promise pending after fetch() returns, so the server has to subscribe to it.
  const nextMacrotask = `const nextMacrotask = () => new Promise(resolve => setImmediate(resolve));`;

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

  function runUpgradeChild(handlers: string, development = false) {
    return runChild(
      `${listeners}
       ${nextMacrotask}
       const server = Bun.serve({
         port: 0,
         development: ${development},
         ${handlers}
         websocket: {
           // Close only after the client replies, so the handler has already failed by then.
           open(ws) { ws.send("hi"); },
           message(ws) { ws.close(); },
         },
       });
       const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
       ws.onerror = () => { console.log("ws error"); process.exit(1); };
       ws.onmessage = async e => { await nextMacrotask(); await nextMacrotask(); console.log("ws got:", e.data); ws.send("bye"); };
       ws.onclose = () => { console.log("pendingRequests:", server.pendingRequests); server.stop(true); };`,
    );
  }

  const syncThrow = `fetch(req, srv) { srv.upgrade(req); throw new Error("E"); },`;
  const asyncThrow = `async fetch(req, srv) { await nextMacrotask(); srv.upgrade(req); throw new Error("E"); },`;

  test.each([
    ["fetch() throws", syncThrow],
    ["a route throws", `routes: { "/": (req, srv) => { srv.upgrade(req); throw new Error("E"); } },`],
    ["fetch() awaits, upgrades, then throws", asyncThrow],
    [
      "fetch()'s promise rejects right before upgrade() in the same task",
      `fetch(req, srv) {
         return new Promise((resolve, reject) => {
           setImmediate(() => { reject(new Error("E")); srv.upgrade(req); });
         });
       },`,
    ],
    [
      "fetch() awaits, upgrades, then throws, and user code also catches the promise",
      `fetch(req, srv) {
         const promise = (async () => { await nextMacrotask(); srv.upgrade(req); throw new Error("E"); })();
         promise.catch(() => {});
         return promise;
       },`,
    ],
  ])("calls error() when %s", async (_, handlers) => {
    expect(await runUpgradeChild(handlers + errorHandler)).toEqual({
      stdoutLines: ["error() saw: E", "pendingRequests: 0", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["fetch() throws with no error() handler", syncThrow, false],
    ["fetch() throws with no error() handler, in development mode", syncThrow, true],
    ["fetch() awaits, upgrades, then throws with no error() handler", asyncThrow, false],
    ["fetch() awaits, upgrades, then throws with no error() handler, in development mode", asyncThrow, true],
    [
      "error() upgrades, then throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       error(err) { server.upgrade(err.req); throw new Error("E"); },`,
      false,
    ],
    [
      "error() awaits, upgrades, then throws",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       async error(err) { await nextMacrotask(); server.upgrade(err.req); throw new Error("E"); },`,
      false,
    ],
  ])("prints the error and keeps serving when %s", async (_, handlers, development) => {
    const { stdoutLines, stderr, exitCode } = await runUpgradeChild(handlers, development);
    expect(stderr).toContain("error: E\n");
    // The process exits on its own, with code 1 like after any printed handler error.
    expect({ stdoutLines, exitCode }).toEqual({ stdoutLines: ["pendingRequests: 0", "ws got: hi"], exitCode: 1 });
  });

  test("reports nothing when the handler returns a Response after upgrading", async () => {
    const handlers = `async fetch(req, srv) { await nextMacrotask(); srv.upgrade(req); return new Response("unused"); },`;
    expect(await runUpgradeChild(handlers + errorHandler)).toEqual({
      stdoutLines: ["pendingRequests: 0", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("still drops a rejection after a client abort", async () => {
    const result = await runChild(
      `${listeners}
       const received = Promise.withResolvers();
       const aborted = Promise.withResolvers();
       const server = Bun.serve({
         port: 0,
         ${errorHandler}
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

  // server.upgrade() responds to an unsupported Sec-WebSocket-Version with a 426 and returns false.
  test("still drops an error thrown after server.upgrade() responded with 426", async () => {
    const result = await runChild(
      `${listeners}
       const server = Bun.serve({
         port: 0,
         hostname: "127.0.0.1",
         ${errorHandler}
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
