import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Every option here is declared as `string` or `boolean` in bake.d.ts. A value
// of another type must throw ERR_INVALID_ARG_TYPE from Bun.serve, before any
// dev server starts.
test("Bun.serve({ app }) rejects wrong-typed framework options", async () => {
  using dir = tempDir("bake-app-options", {
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const framework = { fileSystemRouterTypes: [fsr] };
      const cases = {
        "root": { framework, root: 123 },
        "fileSystemRouterTypes[].root": { framework: { fileSystemRouterTypes: [{ ...fsr, root: 123 }] } },
        "fileSystemRouterTypes[].ignoreUnderscores": {
          framework: { fileSystemRouterTypes: [{ ...fsr, ignoreUnderscores: "yes" }] },
        },
        "fileSystemRouterTypes[].layouts": { framework: { fileSystemRouterTypes: [{ ...fsr, layouts: 1 }] } },
        "serverComponents.serverRuntimeImportSource": {
          framework: { ...framework, serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: 5 } },
        },
        "plugins[].name": { framework, plugins: [{ name: 42, setup() {} }] },
        "plugins[].setup": { framework, plugins: [{ name: "p", setup: "nope" }] },
        "plugins[].setup behind a pending setup()": {
          framework,
          plugins: [
            { name: "pending", setup: () => new Promise(resolve => setImmediate(resolve)) },
            { name: "p", setup: "nope" },
          ],
        },
      };
      for (const [name, app] of Object.entries(cases)) {
        let result;
        try {
          Bun.serve({ port: 0, development: true, app, fetch: () => new Response() }).stop(true);
          result = "no error";
        } catch (e) {
          result = e.code + ": " + e.message;
        }
        console.log(name + " -> " + result);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`
    "root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].ignoreUnderscores -> ERR_INVALID_ARG_TYPE: The "ignoreUnderscores" property must be of type boolean, got string
    fileSystemRouterTypes[].layouts -> ERR_INVALID_ARG_TYPE: The "layouts" property must be of type boolean, got number
    serverComponents.serverRuntimeImportSource -> ERR_INVALID_ARG_TYPE: The "serverRuntimeImportSource" property must be of type string, got number
    plugins[].name -> ERR_INVALID_ARG_TYPE: The "name" property must be of type string, got number
    plugins[].setup -> ERR_INVALID_ARG_TYPE: setup must be a function
    plugins[].setup behind a pending setup() -> ERR_INVALID_ARG_TYPE: setup must be a function
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// Bun.serve() must not run the event loop while it waits for a plugin. It
// returns, and the dev server holds its first bundle back until every setup()
// has settled.
describe.concurrent("Bun.serve({ app }) with a plugin setup() that returns a pending promise", () => {
  const appFiles = {
    "server.ts": `
      export function render(req, meta) {
        return meta.pageModule.default(req, meta);
      }
    `,
    "routes/index.ts": `
      import value from "../value.ts";
      export default function () {
        return new Response("value: " + value);
      }
    `,
    "value.ts": `export default "from the disk";`,
    "app.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      export const framework = {
        fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
      };
      export const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
      // The fixtures settle a setup() promise after Bun.serve() returns. A build that runs the
      // event loop inside the call would keep them in the call for ever, so they stop with this
      // result instead.
      export function serve(options) {
        let returned = false;
        setImmediate(() => {
          if (returned) return;
          console.log(JSON.stringify({ eventLoopRanInsideServe: true }));
          process.exit(1);
        });
        try {
          return Bun.serve(options);
        } finally {
          returned = true;
        }
      }
      // Resolves when the dev server holds a request for a route that is not bundled yet.
      export async function requestIsWaiting(server) {
        while (server.pendingRequests === 0) await nextTurn();
      }
      // Resolves when a dev server was freed after the count was read.
      export async function devServerIsGone(deinitsBefore) {
        while (getDevServerDeinitCount() === deinitsBefore) await nextTurn();
      }
    `,
  };

  // A test that times out does not dispose its fixture, so a fixture that is left is killed here.
  const fixtures = new Set<Bun.Subprocess>();
  afterAll(() => {
    for (const fixture of fixtures) fixture.kill("SIGKILL");
  });

  async function runFixture(dir: string, fixture: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    fixtures.add(proc);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    fixtures.delete(proc);
    return { stdout, stderr, exitCode };
  }

  test("the call returns before the event loop runs", async () => {
    using dir = tempDir("bake-app-plugin-setup-returns", {
      ...appFiles,
      "returns-fixture.ts": `
        import { framework } from "./app.ts";
        let immediateRan = false;
        setImmediate(() => {
          immediateRan = true;
        });
        const server = Bun.serve({
          port: 0,
          development: true,
          // Only the event loop can settle this promise.
          app: { framework, plugins: [{ name: "p", setup: () => new Promise(resolve => setImmediate(resolve)) }] },
          fetch: () => new Response("fallback"),
        });
        console.log(JSON.stringify({ immediateRanInsideServe: immediateRan }));
        await server.stop(true);
      `,
    });
    const { stdout, stderr, exitCode } = await runFixture(String(dir), "returns-fixture.ts");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ immediateRanInsideServe: false });
    expect(exitCode).toBe(0);
  });

  test("a request waits for every setup(), and each setup() runs after the one before it settles", async () => {
    using dir = tempDir("bake-app-plugin-setup-order", {
      ...appFiles,
      "order-fixture.ts": `
        import { framework, requestIsWaiting, serve } from "./app.ts";
        const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
        const order: string[] = [];
        const server = serve({
          port: 0,
          development: true,
          app: {
            framework,
            plugins: [
              {
                name: "first",
                async setup(build) {
                  order.push("first:start");
                  await gate;
                  order.push("first:resume");
                  build.onLoad({ filter: /value\\.ts$/ }, () => {
                    order.push("first:onLoad");
                    return { contents: "export default 'from the first plugin';", loader: "ts" };
                  });
                },
              },
              {
                name: "second",
                setup(build) {
                  order.push("second");
                  // The first plugin registered its callback before this one, so this one does not run.
                  build.onLoad({ filter: /value\\.ts$/ }, () => {
                    order.push("second:onLoad");
                    return { contents: "export default 'from the second plugin';", loader: "ts" };
                  });
                },
              },
            ],
          },
          fetch: () => new Response("fallback"),
        });
        order.push("returned");
        const response = fetch(server.url);
        await requestIsWaiting(server);
        order.push("request is waiting");
        // Only this line lets the first setup() go on.
        openGate();
        const text = await (await response).text();
        await server.stop(true);
        console.log(JSON.stringify({ order, text }));
      `,
    });
    // stderr has the "Bundled page in 12ms" line of the dev server.
    const { stdout, exitCode } = await runFixture(String(dir), "order-fixture.ts");
    expect(JSON.parse(stdout)).toEqual({
      order: ["first:start", "returned", "request is waiting", "first:resume", "second", "first:onLoad"],
      text: "value: from the first plugin",
    });
    expect(exitCode).toBe(0);
  });

  test("a rejection after the call returned is reported, and every request gets an answer", async () => {
    using dir = tempDir("bake-app-plugin-setup-rejects", {
      ...appFiles,
      "rejects-fixture.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        import { devServerIsGone, framework, requestIsWaiting, serve } from "./app.ts";

        // A request waits for the plugins when the rejection arrives. The server stops after that.
        async function rejectThenStop() {
          const { promise: gate, reject: closeGate } = Promise.withResolvers<void>();
          let secondSetupRan = false;
          const deinitsBefore = getDevServerDeinitCount();
          const server = serve({
            port: 0,
            development: true,
            app: {
              framework,
              plugins: [
                { name: "first", setup: () => gate },
                {
                  name: "second",
                  setup() {
                    secondSetupRan = true;
                  },
                },
              ],
            },
            fetch: () => new Response("fallback"),
          });
          const waiting = fetch(server.url);
          await requestIsWaiting(server);
          // The call above did not throw. The rejection arrives now.
          closeGate(new Error("rejected before the server stopped"));
          const whileWaiting = (await waiting).status;
          const afterwards = await (await fetch(server.url)).text();
          const pendingRequests = server.pendingRequests;
          await server.stop(true);
          // A request context that is not released keeps the dev server alive.
          await devServerIsGone(deinitsBefore);
          return { secondSetupRan, whileWaiting, afterwards, pendingRequests };
        }

        // The listener closes first. Only the request that waits keeps the server alive, so
        // the answer to it is what lets the dev server go.
        async function stopThenReject() {
          const { promise: gate, reject: closeGate } = Promise.withResolvers<void>();
          const deinitsBefore = getDevServerDeinitCount();
          const server = serve({
            port: 0,
            development: true,
            app: { framework, plugins: [{ name: "first", setup: () => gate }] },
            fetch: () => new Response("fallback"),
          });
          const waiting = fetch(server.url);
          await requestIsWaiting(server);
          const stopped = server.stop();
          closeGate(new Error("rejected after server.stop()"));
          const whileWaiting = (await waiting).status;
          await stopped;
          await devServerIsGone(deinitsBefore);
          return { whileWaiting };
        }

        console.log(JSON.stringify({ rejectThenStop: await rejectThenStop(), stopThenReject: await stopThenReject() }));
      `,
    });
    const { stdout, stderr, exitCode } = await runFixture(String(dir), "rejects-fixture.ts");
    expect(JSON.parse(stdout)).toEqual({
      rejectThenStop: { secondSetupRan: false, whileWaiting: 500, afterwards: "Plugin Error", pendingRequests: 0 },
      stopThenReject: { whileWaiting: 500 },
    });
    expect(stderr).toContain("Failed to load plugins for Bun.serve");
    expect(stderr).toContain("rejected before the server stopped");
    expect(stderr).toContain("rejected after server.stop()");
    expect(exitCode).toBe(0);
  });

  test("a dev server that is gone when setup() settles is left alone", async () => {
    using dir = tempDir("bake-app-plugin-setup-gone", {
      ...appFiles,
      "gone-fixture.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        import { framework, nextTurn, serve } from "./app.ts";

        // Bun.serve() throws after the dev server exists, so the dev server is freed in the call.
        async function listenFails() {
          const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
          let secondSetupRan = false;
          const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });
          const deinitsBefore = getDevServerDeinitCount();
          let code = "listen succeeded";
          try {
            serve({
              hostname: "127.0.0.1",
              port: taken.port,
              development: true,
              app: {
                framework,
                plugins: [
                  { name: "first", setup: () => gate },
                  {
                    name: "second",
                    setup() {
                      secondSetupRan = true;
                    },
                  },
                ],
              },
              fetch: () => new Response("fallback"),
            }).stop(true);
          } catch (e) {
            code = e.code;
          }
          const deinits = getDevServerDeinitCount() - deinitsBefore;
          openGate();
          await nextTurn();
          await taken.stop(true);
          return { code, deinits, secondSetupRan };
        }

        // A setup() that stops the server ends the setup() calls.
        async function setupStopsServer() {
          const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
          let thirdSetupRan = false;
          const server = serve({
            port: 0,
            development: true,
            app: {
              framework,
              plugins: [
                { name: "first", setup: () => gate },
                {
                  name: "second",
                  setup() {
                    server.stop(true);
                  },
                },
                {
                  name: "third",
                  setup() {
                    thirdSetupRan = true;
                  },
                },
              ],
            },
            fetch: () => new Response("fallback"),
          });
          openGate();
          await nextTurn();
          return { thirdSetupRan };
        }

        // Nothing is left to tell, but the error is still reported.
        async function rejectAfterStop() {
          const { promise: gate, reject: closeGate } = Promise.withResolvers<void>();
          const server = serve({
            port: 0,
            development: true,
            app: { framework, plugins: [{ name: "first", setup: () => gate }] },
            fetch: () => new Response("fallback"),
          });
          await server.stop(true);
          closeGate(new Error("rejected after the server was gone"));
          await nextTurn();
          return { stopped: true };
        }

        console.log(
          JSON.stringify({
            listenFails: await listenFails(),
            setupStopsServer: await setupStopsServer(),
            rejectAfterStop: await rejectAfterStop(),
          }),
        );
      `,
    });
    const { stdout, stderr, exitCode } = await runFixture(String(dir), "gone-fixture.ts");
    expect(JSON.parse(stdout)).toEqual({
      listenFails: { code: "EADDRINUSE", deinits: 1, secondSetupRan: false },
      setupStopsServer: { thirdSetupRan: false },
      rejectAfterStop: { stopped: true },
    });
    expect(stderr).toContain("Failed to load plugins for Bun.serve");
    expect(stderr).toContain("rejected after the server was gone");
    expect(exitCode).toBe(0);
  });
});
