import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";

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
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test('Bun.serve({ app }) reports a framework entry point that a "browser" map disables', async () => {
  using dir = tempDir("bake-app-disabled-entry", {
    "package.json": JSON.stringify({ name: "app", browser: { "./client.ts": false } }),
    "client.ts": `export {};`,
    "server.ts": `export function render() { return new Response("ok"); }`,
    "routes/index.ts": `export default () => new Response("ok");`,
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", clientEntryPoint: "./client.ts" };
      try {
        Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } }).stop(true);
        console.log("no error");
      } catch (e) {
        console.log("threw: " + e.message);
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

  expect(stderr).toContain("Failed to resolve './client.ts' for framework (client side entrypoint)");
  expect(stdout).toBe("threw: Framework is missing required files!\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) frees the bundler plugin when the config is rejected", async () => {
  using dir = tempDir("bake-app-plugin-leak", {
    "fixture.ts": `
      import { heapStats } from "bun:jsc";
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      // The framework's plugins are parsed first, then root fails the type check.
      const app = { framework: { fileSystemRouterTypes: [fsr], plugins: [] }, root: 123 };
      const count = () => heapStats().protectedObjectTypeCounts.BundlerPlugin ?? 0;
      const before = count();
      const errors = new Set();
      for (let i = 0; i < 10; i++) {
        try {
          Bun.serve({ port: 0, development: true, app, fetch: () => new Response() }).stop(true);
          errors.add("no error");
        } catch (e) {
          errors.add(e.code);
        }
      }
      console.log("errors: " + [...errors].join(", "));
      console.log("leaked plugins: " + (count() - before));
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

  expect(stdout).toBe("errors: ERR_INVALID_ARG_TYPE\nleaked plugins: 0\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) skips the directories in fileSystemRouterTypes[].ignoreDirs", async () => {
  using dir = tempDir("bake-app-ignore-dirs", {
    "server.ts": `export function render() { return new Response("ok"); }`,
    "routes/index.ts": `export default 1;`,
    // Both routes are invalid. Only the one outside ignoreDirs is scanned and reported.
    "routes/skipped/[].ts": `export default 1;`,
    "routes/scanned/[].ts": `export default 1;`,
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", ignoreDirs: ["skipped"] };
      Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } }).stop(true);
      console.log("started");
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

  expect(stderr).toContain("scanned/[].ts");
  expect(stderr).not.toContain("skipped/[].ts");
  expect(stdout).toBe("started\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) reports a route with more than 64 params", async () => {
  const route = Array.from({ length: 65 }, (_, i) => `[p${i}]`).join("/");
  using dir = tempDir("bake-app-too-many-params", {
    "server.ts": `export function render() { return new Response("ok"); }`,
    [`routes/${route}.ts`]: `export default 1;`,
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } }).stop(true);
      console.log("started");
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

  expect(stderr).toContain("Pattern cannot have more than 64 param");
  expect(stdout).toBe("started\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) serves routes when root is a relative path", async () => {
  using dir = tempDir("bake-app-relative-root", {
    "server.ts": `export function render(req, meta) { return meta.pageModule.default(); }`,
    "routes/index.ts": `export default () => new Response("index route");`,
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] }, root: "./" },
        fetch: () => new Response("fallback"),
      });
      const res = await fetch(server.url);
      console.log(res.status + " " + (await res.text()));
      await server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // The dev server also prints a "Bundled page" line.
  expect(stdout.split("\n")).toContain("200 index route");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) rejects a root longer than the path buffer", async () => {
  using dir = tempDir("bake-app-long-root", {
    "server.ts": `export function render() { return new Response("ok"); }`,
    "fixture.ts": `
      const long = Buffer.alloc(100_000, "a").toString();
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const cases = {
        "root": { root: long, framework: { fileSystemRouterTypes: [fsr] } },
        "fileSystemRouterTypes[0].root": { framework: { fileSystemRouterTypes: [{ ...fsr, root: long }] } },
      };
      for (const [name, app] of Object.entries(cases)) {
        try {
          Bun.serve({ port: 0, development: true, app, fetch: () => new Response() }).stop(true);
          console.log(name + " -> no error");
        } catch (e) {
          console.log(name + " -> " + e.message);
        }
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

  expect(stderr).toBe("ENAMETOOLONG: Failed to resolve 'fileSystemRouterTypes[0].root' for framework\n");
  expect(stdout).toBe(
    "root -> 'app.root' is too long\nfileSystemRouterTypes[0].root -> Framework is missing required files!\n",
  );
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) routes on the request target's pathname", async () => {
  using dir = tempDir("bake-app-request-target", {
    "server.ts": `export function render(req, meta) { return meta.pageModule.default(req, meta); }`,
    "routes/index.ts": `export default () => new Response("index route");`,
    "routes/echo/[...rest].ts": `export default (req, meta) => new Response("rest=" + meta.params.rest.join());`,
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const origin = "http://127.0.0.1:" + server.port;
      for (const requestLine of [
        "GET /?a=b",
        "GET /echo/https://example.com/a?q=1#hash",
        "GET " + origin + "/echo/a/b?q=1",
        "GET " + origin,
        "GET " + origin + "?next=/echo/a",
        "CONNECT 127.0.0.1:" + server.port,
      ]) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let response = "";
        await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: {
            open: socket => void socket.write(requestLine + " HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n"),
            data: (socket, chunk) => void (response += chunk),
            close: resolve,
            error: (socket, error) => reject(error),
          },
        });
        await promise;
        console.log(response.slice(9, 12), response.split("\\r\\n\\r\\n")[1]);
      }
      await server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.split("\n")).toEqual([
    "200 index route",
    "200 rest=https:,example.com,a",
    "200 rest=a,b",
    "200 index route",
    "200 index route",
    "404 404 Not Found",
    "",
  ]);
  expect(exitCode).toBe(0);
});

// The project root is apps/api.
test.concurrent.each([
  ["inside the project root", "pages", "apps/api/pages"],
  ["a sibling directory", "../web/pages", "apps/web/pages"],
  ["an ancestor directory", "..", "apps"],
  ["a directory next to an ancestor", "../../routes", "routes"],
])("Bun.serve({ app }) serves routes from a router root that is %s", async (_, root, pages) => {
  // An ancestor directory also contains the project's own files, which become routes.
  const withSyntaxError = root !== "..";
  using dir = tempDir("bake-app-router-root", {
    "apps/api/server.ts": `export function render(req, meta) { return meta.pageModule.default(req, meta); }`,
    "apps/api/fixture.ts": `
      const fsr = { root: ${JSON.stringify(root)}, style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      for (const pathname of ["/", "/blog/hello"]) {
        const res = await fetch(new URL(pathname, server.url));
        console.log(pathname, res.status, await res.text());
      }
      await server.stop(true);
    `,
    [`${pages}/index.ts`]: `export default () => new Response("index");`,
    [`${pages}/blog/[slug].ts`]: `export default (req, meta) => new Response(meta.params.slug);`,
    ...(withSyntaxError && { [`${pages}/blog/[oops.ts`]: `export default () => new Response("");` }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir) + "/apps/api",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout, stderr).toBe("/ 200 index\n/blog/hello 200 hello\n");
  if (withSyntaxError) {
    // The message is indented to the column of the offending character.
    const label = `${root}/blog/[oops.ts`;
    const indent = Buffer.alloc(`error: "`.length + label.indexOf("["), " ").toString();
    expect(stderr).toContain(`error: "${label}" is not a valid route\n`);
    expect(stderr).toContain(`\n${indent}Missing "]" to match this route parameter\n`);
  }
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) reports an unsupported app router file", async () => {
  using dir = tempDir("bake-app-extra-file", {
    "server.ts": `export function render(req, meta) { return meta.pageModule.default(); }`,
    "app/page.ts": `export default () => new Response("page");`,
    "app/loading.ts": `export default () => new Response("loading");`,
    "fixture.ts": `
      const fsr = { root: "app", style: "nextjs-app-ui", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const res = await fetch(server.url);
      console.log(res.status, await res.text());
      await server.stop(true);
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

  expect(stderr).toContain('error: "app/loading.ts" is not a valid route\n');
  expect(stderr).toContain('Bun Bake currently does not support "loading" files\n');
  expect(stdout).toBe("200 page\n");
  expect(exitCode).toBe(0);
});

// Bun.serve() never runs the event loop to wait for a plugin. Requests wait instead.
const pluginSetupFiles = {
  "server.ts": `export function render(req, meta) { return meta.pageModule.default(req, meta); }`,
  "routes/index.ts": `export default () => new Response("ok");`,
  "serve.ts": `
    import { heapStats } from "bun:jsc";
    export const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
    export const turn = () => new Promise(resolve => setImmediate(resolve));
    export const pluginCells = () => heapStats().protectedObjectTypeCounts.BundlerPlugin ?? 0;
    // On a build that runs the event loop inside Bun.serve(), these fixtures would never leave the call.
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
  `,
};

// A test that times out does not dispose its fixture, and a fixture with a server does not exit by itself.
const pluginSetupFixtures = new Set<Bun.Subprocess>();
afterAll(() => {
  for (const fixture of pluginSetupFixtures) fixture.kill("SIGKILL");
});

async function runPluginSetupFixture(dir: string, flags: string[] = [], env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...flags, "fixture.ts"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  pluginSetupFixtures.add(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  pluginSetupFixtures.delete(proc);
  const line = stdout.trim().split("\n").at(-1);
  return { result: line?.startsWith("{") ? JSON.parse(line) : line, stderr, exitCode };
}

test.concurrent("Bun.serve({ app }) returns before a pending plugin setup() settles", async () => {
  using dir = tempDir("bake-app-async-plugin", {
    ...pluginSetupFiles,
    "routes/index.ts": `
      import { first } from "virtual:first";
      import { second } from "virtual:second";
      import { both } from "virtual:both";
      export default () => new Response([first, second, both].join(" "));
    `,
    "fixture.ts": `
      import { fsr, serve, turn } from "./serve.ts";
      const events = [];
      const seenBy = {};
      const gate = Promise.withResolvers();
      const virtual = (name, wait) => ({
        name,
        async setup(build) {
          events.push(name + " starts");
          await wait;
          // The plugins of one array share \`build.config\`.
          seenBy[name] = [...(build.config.seenBy ??= []), name];
          build.config.seenBy.push(name);
          build.onResolve({ filter: new RegExp("^virtual:(both|" + name + ")$") }, args => ({
            path: args.path.slice("virtual:".length),
            namespace: name,
          }));
          build.onLoad({ filter: /./, namespace: name }, args => ({
            contents: "export const " + args.path + " = " + JSON.stringify(name),
            loader: "js",
          }));
          events.push(name + " ends");
        },
      });
      setImmediate(() => events.push("immediate"));
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr], plugins: [virtual("first", gate.promise)] },
          plugins: [virtual("second", gate.promise.then(turn)), virtual("third")],
        },
      });
      events.push("Bun.serve() returned");
      // This request arrives while the first plugin is pending.
      const response = fetch(server.url);
      while (server.pendingRequests === 0) await turn();
      gate.resolve();
      console.log(JSON.stringify({ body: await (await response).text(), again: await (await fetch(server.url)).text(), events, seenBy }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  // The plugins register in the order they are listed in, so the first one gets "virtual:both".
  expect(result, stderr).toEqual({
    body: "first second first",
    again: "first second first",
    events: [
      "first starts",
      "Bun.serve() returned",
      "immediate",
      "first ends",
      "second starts",
      "second ends",
      "third starts",
      "third ends",
    ],
    seenBy: { first: ["first"], second: ["second"], third: ["second", "third"] },
  });
  expect(exitCode).toBe(0);
});

// What runs inside the call: a loop iteration, or only a job (the "await" row on a build that waits).
test.concurrent("Bun.serve({ app }) runs no job and no loop iteration for a plugin setup()", async () => {
  using dir = tempDir("bake-app-async-plugin-nothing-runs", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { getEventLoopStats } from "bun:internal-for-testing";
      import { fsr, serve } from "./serve.ts";
      const gates = [];
      const setups = {
        await: async () => void (await 1),
        pending() {
          gates.push(Promise.withResolvers());
          return gates.at(-1).promise;
        },
        rejected: async () => {
          throw new Error("already rejected");
        },
      };
      const rows = {};
      for (const where of ["app", "framework"]) {
        for (const [shape, setup] of Object.entries(setups)) {
          const plugins = [{ name: shape, setup }, { name: "after it", setup() {} }];
          const framework = { fileSystemRouterTypes: [fsr], plugins: where === "framework" ? plugins : [] };
          let jobRan = false;
          queueMicrotask(() => void (jobRan = true));
          const before = getEventLoopStats().iteration;
          let server;
          let threw = null;
          try {
            server = serve({ port: 0, development: true, app: { framework, plugins: where === "app" ? plugins : [] } });
          } catch (e) {
            threw = e.message;
          }
          rows[where + ": " + shape] = { iterations: getEventLoopStats().iteration - before, jobRan, threw };
          for (const gate of gates.splice(0)) gate.resolve();
          await server?.stop(true);
        }
      }
      console.log(JSON.stringify(rows));
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  const nothingRan = { iterations: 0, jobRan: false, threw: null };
  expect(result, stderr).toEqual({
    "app: await": nothingRan,
    "app: pending": nothingRan,
    "app: rejected": { ...nothingRan, threw: "already rejected" },
    "framework: await": nothingRan,
    "framework: pending": nothingRan,
    "framework: rejected": { ...nothingRan, threw: "already rejected" },
  });
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["the pending one rejects", "[]", "[rejects, last]", ["rejects"]],
  ["the next one throws", "[]", "[waits, throws, last]", ["waits", "throws"]],
  ["the next one rejects", "[]", "[waits, rejectsAtOnce, last]", ["waits", "rejects at once"]],
  ["the pending one of framework.plugins rejects", "[rejects, last]", "[last]", ["rejects"]],
  [
    "one of app.plugins throws behind a pending one of framework.plugins",
    "[waits, behind]",
    "[throws, last]",
    ["waits", "behind", "throws"],
  ],
])("Bun.serve({ app }) reports a plugin setup() that fails later: %s", async (_, frameworkPlugins, appPlugins, ran) => {
  using dir = tempDir("bake-app-async-plugin-rejects", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const ran = [];
      const plugin = (name, setup = () => {}) => ({ name, setup: build => (ran.push(name), setup(build)) });
      const waits = plugin("waits", () => gate.promise);
      const behind = plugin("behind");
      const rejects = plugin("rejects", () => gate.promise.then(() => Promise.reject(new Error("setup failed"))));
      const throws = plugin("throws", () => {
        throw new Error("setup failed");
      });
      const rejectsAtOnce = plugin("rejects at once", async () => {
        throw new Error("setup failed");
      });
      const last = plugin("last");
      const cellsBefore = pluginCells();
      const server = serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr], plugins: ${frameworkPlugins} }, plugins: ${appPlugins} },
      });
      const waiting = fetch(server.url);
      while (server.pendingRequests === 0) await turn();
      gate.resolve();
      const result = { waiting: (await waiting).status, later: await (await fetch(server.url)).text() };
      const pending = server.pendingRequests;
      // The dev server has the plugin until the server stops.
      await server.stop(true);
      console.log(JSON.stringify({ ...result, pending, ran, pluginCells: pluginCells() - cellsBefore }));
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ waiting: 500, later: "Plugin Error", pending: 0, ran, pluginCells: 0 });
  expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
  expect(stderr).toContain("setup failed");
  expect(exitCode).toBe(0);
});

// The call has already run the first setup() when it throws. The ones behind it must not run later.
test.concurrent("Bun.serve({ app }) that throws behind a pending plugin setup() runs no other setup()", async () => {
  using dir = tempDir("bake-app-async-plugin-throws", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });
      // With inFramework the pending setup() is one of framework.plugins, and "plugins" is all of app.plugins.
      const cases = {
        "a plugin behind it is not a plugin": { plugins: [{ name: "no setup" }] },
        "an option behind app is not valid": { fetch: "not a function" },
        "the dev server does not start": { fsr: { ...fsr, serverEntryPoint: "./missing.ts" } },
        "the port is taken": { hostname: "127.0.0.1", port: taken.port },
        "a plugin of app.plugins is not a plugin": { inFramework: true, plugins: [{ name: "no setup" }] },
        "app.plugins is not an array": { inFramework: true, plugins: "not an array" },
        "app.root is not a string": { inFramework: true, root: 123 },
      };
      const cellsBefore = pluginCells();
      const result = {};
      for (const [name, { inFramework, plugins = [], root, fsr: routerType = fsr, ...options }] of Object.entries(cases)) {
        const gate = Promise.withResolvers();
        const ran = [];
        const pending = [{ name: "waits", setup: () => gate.promise }, { name: "behind", setup: () => void ran.push("behind") }];
        const app = {
          framework: { fileSystemRouterTypes: [routerType], ...(inFramework && { plugins: pending }) },
          plugins: inFramework ? plugins : [...pending, ...plugins],
          ...(root !== undefined && { root }),
        };
        try {
          serve({ port: 0, development: true, app, ...options }).stop(true);
          ran.push("Bun.serve() returned");
        } catch (e) {
          ran.push(e.code ?? e.message);
        }
        gate.resolve();
        await gate.promise;
        await turn();
        result[name] = ran;
      }
      await taken.stop(true);
      console.log(JSON.stringify({ ...result, pluginCells: pluginCells() - cellsBefore }));
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({
    "a plugin behind it is not a plugin": ["ERR_INVALID_ARG_TYPE"],
    "an option behind app is not valid": ["ERR_INVALID_ARG_TYPE"],
    "the dev server does not start": ["Framework is missing required files!"],
    "the port is taken": ["EADDRINUSE"],
    "a plugin of app.plugins is not a plugin": ["ERR_INVALID_ARG_TYPE"],
    "app.plugins is not an array": ["ERR_INVALID_ARG_TYPE"],
    "app.root is not a string": ["ERR_INVALID_ARG_TYPE"],
    pluginCells: 0,
  });
  expect(exitCode).toBe(0);
});

// The dev server has the plugin, and it goes when the server has stopped.
test.concurrent("a plugin setup() that stops the server ends the setup() calls that are left", async () => {
  using dir = tempDir("bake-app-async-plugin-stops", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const stopped = Promise.withResolvers();
      const ran = [];
      const cellsBefore = pluginCells();
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [
            { name: "waits", setup: () => gate.promise },
            {
              name: "stops",
              setup() {
                ran.push("stops");
                server.stop(true);
                Bun.gc(true);
                stopped.resolve();
              },
            },
            { name: "last", setup: () => void ran.push("last") },
          ],
        },
      });
      gate.resolve();
      await stopped.promise;
      await turn();
      console.log(JSON.stringify({ ran, pluginCells: pluginCells() - cellsBefore }));
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ ran: ["stops"], pluginCells: 0 });
  expect(exitCode).toBe(0);
});

test.concurrent("a plugin setup() that settles after server.stop() finds no dev server", async () => {
  using dir = tempDir("bake-app-async-plugin-stopped", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, serve, turn } from "./serve.ts";
      for (const settle of ["resolve", "reject"]) {
        const gate = Promise.withResolvers();
        const server = serve({
          port: 0,
          development: true,
          app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [{ name: "late", setup: () => gate.promise }] },
        });
        await server.stop(true);
        Bun.gc(true);
        gate[settle](new Error("too late"));
        await turn();
      }
      console.log("done");
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toBe("done");
  expect(stderr).toContain("too late");
  expect(exitCode).toBe(0);
});

test.concurrent("server.stop() frees the plugin and ends the setup() calls that are left", async () => {
  using dir = tempDir("bake-app-async-plugin-stop-frees", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      let collected = 0;
      const registry = new FinalizationRegistry(() => void collected++);
      const ran = [];
      const cells = [];
      const gates = [];
      const kept = [];
      const cellsBefore = pluginCells();
      // A separate function so that the stack doesn't reference the server after it returns.
      async function stopped(how) {
        const gate = Promise.withResolvers();
        const behind = { name: "behind", setup: () => void ran.push("behind the one that " + how) };
        const server = serve({
          port: 0,
          development: true,
          app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [{ name: "waits", setup: () => gate.promise }, behind] },
        });
        if (how === "settled first") {
          gate.resolve();
          await turn();
        } else {
          gates.push(gate);
        }
        await server.stop(true);
        cells.push(pluginCells() - cellsBefore);
        if (how === "stays referenced") kept.push(server);
        else registry.register(server, how);
      }
      await stopped("settled first");
      await stopped("stays referenced");
      await stopped("resolves after it is collected");
      await stopped("rejects after it is collected");
      for (let i = 0; i < 50 && collected < 3; i++) {
        Bun.gc(true);
        await turn();
      }
      gates[0].resolve();
      gates[1].resolve();
      gates[2].reject(new Error("too late"));
      await turn();
      console.log(JSON.stringify({ collected, ran, cells }));
      // The error that was reported would make the exit code 1.
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ collected: 3, ran: ["behind the one that settled first"], cells: [0, 0, 0, 0] });
  // The error of a server that is gone is still reported.
  expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
  expect(stderr).toContain("too late");
  expect(exitCode).toBe(0);
});

// The reactions of a setup() that is pending never run when the VM shuts down. What they hold must still go.
// LeakSanitizer is what sees it, and it runs on Linux.
test.concurrent.skipIf(!isASAN || !isLinux)(
  "a VM that shuts down with a Bun.serve({ app }) server leaks nothing of its plugin setup()",
  async () => {
    using dir = tempDir("bake-app-async-plugin-shutdown", {
      ...pluginSetupFiles,
      "fixture.ts": `
        import { fsr, serve, turn } from "./serve.ts";
        const servers = [];
        for (const state of ["loaded", "loaded, stopped", "pending", "pending, a request", "pending, stopped", "pending, a request, stopped"]) {
          const gate = Promise.withResolvers();
          // After an await, so that no frame of the module's evaluation is in a leak's stack: a suppression names it.
          await turn();
          const server = serve({
            port: 0,
            development: true,
            app: {
              framework: { fileSystemRouterTypes: [fsr] },
              plugins: [{ name: "waits", setup: () => gate.promise }, { name: "behind", setup() {} }],
            },
          });
          if (state.startsWith("loaded")) {
            gate.resolve();
            await (await fetch(server.url)).text();
          }
          if (state.includes("a request")) {
            fetch(server.url).catch(() => {});
            while (server.pendingRequests === 0) await turn();
          }
          if (state.endsWith("stopped")) await server.stop(true);
          servers.push(server);
        }
        console.log(JSON.stringify({ servers: servers.length }));
        process.exit(0);
      `,
    });

    const env = {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../leaksan.supp")}`,
    };
    const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir), [], env);

    expect({ result, exitCode }, stderr).toEqual({ result: { servers: 6 }, exitCode: 0 });
  },
);

// With --hot, a second call with the same id only reloads the server. Its options are dropped.
test.concurrent("a second Bun.serve({ id, app }) call drops its pending plugin setup()", async () => {
  using dir = tempDir("bake-app-async-plugin-hot", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { getEventLoopStats } from "bun:internal-for-testing";
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      const ran = [];
      const gates = [];
      const options = call => {
        gates.push(Promise.withResolvers());
        const behind = { name: "behind", setup: () => void ran.push("behind the " + call) };
        const plugins = [{ name: "waits", setup: () => gates.at(-1).promise }, behind];
        return { id: "one server", port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] }, plugins } };
      };
      const server = serve(options("first call"));
      const cellsBefore = pluginCells();
      let jobRan = false;
      queueMicrotask(() => void (jobRan = true));
      const iterationsBefore = getEventLoopStats().iteration;
      const sameServer = serve(options("second call")) === server;
      const iterations = getEventLoopStats().iteration - iterationsBefore;
      const result = { sameServer, iterations, jobRan, pluginCells: pluginCells() - cellsBefore };
      gates[0].resolve();
      gates[1].reject(new Error("the second call failed"));
      await turn();
      console.log(JSON.stringify({ ...result, ran }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir), ["--hot"]);

  expect(result, stderr).toEqual({
    sameServer: true,
    iterations: 0,
    jobRan: false,
    pluginCells: 0,
    ran: ["behind the first call"],
  });
  // The second call threw nothing, so its setup() reports the error when it rejects.
  expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
  expect(stderr).toContain("the second call failed");
  expect(exitCode).toBe(0);
});

// A setup() can write route files, and Bun.serve() does not wait for a pending one. So the dev server reads the route
// directories when the last setup() has settled, and no request is routed before that.
const routeWritingFiles = {
  ...pluginSetupFiles,
  "pages.ts": `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    export function page(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "export default () => new Response(" + JSON.stringify(text) + ");");
    }
    export async function get(server, path, init) {
      const response = await fetch(new URL(path, server.url), init);
      return response.status + " " + (await response.text());
    }
  `,
};

test.concurrent.each([
  ["app.plugins", "[]", "[codegen, behind]", false],
  ["framework.plugins", "[codegen, behind]", "[]", false],
  ["the options that the entry point exports", "[codegen]", "[behind]", true],
])(
  "Bun.serve({ app }) routes the files that a pending plugin setup() writes: %s",
  async (_, frameworkPlugins, appPlugins, exported) => {
    using dir = tempDir("bake-app-async-plugin-routes", {
      ...routeWritingFiles,
      "routes/blog/index.ts": `export default () => new Response("blog");`,
      "routes/order/[b].ts": `export default () => new Response("[b]");`,
      "fixture.ts": `
        import { get, page } from "./pages.ts";
        import { fsr, serve, turn } from "./serve.ts";
        const codegen = {
          name: "codegen",
          async setup() {
            await turn();
            page("routes/generated.ts", "generated");
            page("routes/blog/new.ts", "new post");
            // One scan of this file and of routes/order/[b].ts puts this one first.
            page("routes/order/[...a].ts", "[...a]");
          },
        };
        // A synchronous setup() behind a pending one also runs after Bun.serve() has returned.
        const behind = { name: "behind", setup: () => page("routes/nested/page.ts", "nested") };
        const options = {
          port: 0,
          development: true,
          app: { framework: { fileSystemRouterTypes: [fsr], plugins: ${frameworkPlugins} }, plugins: ${appPlugins} },
          fetch: () => new Response("no page", { status: 404 }),
        };
        const started = Promise.withResolvers();
        const exported = ${exported};
        if (exported) {
          // Bun calls Bun.serve() with the default export of the entry point when the file has run.
          const serveNow = Bun.serve;
          Bun.serve = options => {
            const server = serveNow(options);
            started.resolve(server);
            return server;
          };
        } else {
          started.resolve(serve(options));
        }
        export default exported ? options : undefined;
        started.promise.then(async server => {
          const result = {};
          for (const path of ["/", "/generated", "/blog/new", "/nested/page", "/order/x", "/blog", "/missing"]) {
            result[path] = await get(server, path);
          }
          console.log(JSON.stringify(result));
          await server.stop(true);
          process.exit(0);
        });
      `,
    });

    const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

    expect(result, stderr).toEqual({
      "/": "200 ok",
      "/generated": "200 generated",
      "/blog/new": "200 new post",
      "/nested/page": "200 nested",
      "/order/x": "200 [...a]",
      "/blog": "200 blog",
      "/missing": "404 no page",
    });
    expect(exitCode).toBe(0);
  },
);

// Bun.serve() resolves the entry point of the framework, so the resolver has read src and src/fw before the setup().
const entryPointInRoot = `{ root: "src", serverEntryPoint: "./src/fw/server.ts" }`;
test.concurrent.each([
  ["a directory that a setup() creates", `{ root: "pages" }`, "pages/late.ts", "/late"],
  ["a directory below one that a setup() creates", `{ root: "made/by/setup" }`, "made/by/setup/late.ts", "/late"],
  ["a directory that the resolver has read", entryPointInRoot, "src/late.ts", "/late"],
  ["a directory below one that the resolver has read", entryPointInRoot, "src/fw/late.ts", "/fw/late"],
])(
  "Bun.serve({ app }) reads a route directory after the plugin setup() calls: %s",
  async (_, routerType, file, url) => {
    using dir = tempDir("bake-app-async-plugin-route-root", {
      ...routeWritingFiles,
      "src/fw/server.ts": pluginSetupFiles["server.ts"],
      // A directory that the resolver read too early has no parent, and a file in it finds no package.
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js" }),
      "node_modules/pkg/index.js": `module.exports = { name: "pkg" };`,
      "fixture.ts": `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { dirname } from "node:path";
      import { get } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const file = ${JSON.stringify(file)};
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [{ ...fsr, ...${routerType} }] },
          plugins: [
            {
              name: "codegen",
              async setup() {
                await turn();
                mkdirSync(dirname(file), { recursive: true });
                writeFileSync(file, 'import { name } from "pkg";\\nexport default () => new Response("late " + name);');
              },
            },
          ],
        },
        fetch: () => new Response("no page", { status: 404 }),
      });
      const url = ${JSON.stringify(url)};
      console.log(JSON.stringify({ late: await get(server, url), again: await get(server, url) }));
      await server.stop(true);
      process.exit(0);
    `,
    });

    const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

    expect(result, stderr).toEqual({ late: "200 late pkg", again: "200 late pkg" });
    expect(exitCode).toBe(0);
  },
);

// A request that arrives while a setup() is pending has no answer yet: the setup() can write the page for it.
test.concurrent("Bun.serve({ app }) holds each request until the plugin setup() calls have settled", async () => {
  using dir = tempDir("bake-app-async-plugin-window", {
    ...routeWritingFiles,
    "routes/[slug].ts": `
      const shape = req => Object.prototype.toString.call(req);
      export default (req, meta) => new Response(["slug", meta.params.slug, shape(req)].join(" "));
    `,
    "fixture.ts": `
      import { get, page } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const seen = [];
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [{ name: "codegen", setup: () => gate.promise.then(() => page("routes/generated.ts", "generated")) }],
        },
        async fetch(req, server) {
          // What fetch gets for a request that did not wait: a Request with no params, and the server twice.
          const shape = [Object.prototype.toString.call(req), "params" in req, this === server];
          seen.push([req.method, new URL(req.url).pathname, ...shape].join(" "));
          return new Response("fetch " + (await req.text()));
        },
      });
      let answered = 0;
      const responses = [];
      const requests = [["/generated"], ["/api/status"], ["/api/echo", { method: "POST", body: "a body" }], ["/"], ["/x"]];
      for (const [path, init] of requests) {
        const before = server.pendingRequests + answered;
        responses.push(get(server, path, init).finally(() => answered++));
        // One at a time, so that the server gets them in this order.
        while (server.pendingRequests + answered === before) await turn();
      }
      const waiting = { held: server.pendingRequests, seen: [...seen] };
      gate.resolve();
      const result = { waiting, responses: await Promise.all(responses), seen, pending: server.pendingRequests };
      console.log(JSON.stringify({ ...result, later: await get(server, "/y") }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({
    waiting: { held: 5, seen: [] },
    // routes/[slug].ts was there for "/generated" when the request arrived. The page that the setup() wrote answers it.
    responses: ["200 generated", "200 fetch ", "200 fetch a body", "200 ok", "200 slug x [object BunRequest]"],
    seen: ["GET /api/status [object Request] false true", "POST /api/echo [object Request] false true"],
    pending: 0,
    // A page gets the same kind of request when it did not wait.
    later: "200 slug y [object BunRequest]",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) answers the requests that waited for a plugin setup() that fails", async () => {
  using dir = tempDir("bake-app-async-plugin-window-rejects", {
    ...routeWritingFiles,
    "fixture.ts": `
      import { get, page } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [
            {
              name: "codegen",
              async setup() {
                await gate.promise;
                page("routes/generated.ts", "generated");
                throw new Error("setup failed");
              },
            },
          ],
        },
        fetch: () => new Response("fetch"),
      });
      let answered = 0;
      const waiting = ["/generated", "/api/status", "/"].map(path => get(server, path).finally(() => answered++));
      while (server.pendingRequests + answered < 3) await turn();
      const held = server.pendingRequests;
      gate.resolve();
      const result = { held, waiting: await Promise.all(waiting), pending: server.pendingRequests };
      result.later = [await get(server, "/generated"), await get(server, "/api/status")];
      console.log(JSON.stringify(result));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  // A page cannot be bundled without the plugins. fetch needs none.
  expect(result, stderr).toEqual({
    held: 3,
    waiting: ["500 ", "200 fetch", "500 "],
    pending: 0,
    later: ["200 Plugin Error", "200 fetch"],
  });
  expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
  expect(exitCode).toBe(0);
});

// The dev server answers the requests that waited one after the other. The first answer can end the server.
test.concurrent("a fetch handler that stops the server ends the other requests that waited", async () => {
  using dir = tempDir("bake-app-async-plugin-window-stop", {
    ...routeWritingFiles,
    "fixture.ts": `
      import { get } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const seen = [];
      const server = serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [{ name: "waits", setup: () => gate.promise }] },
        fetch(req, server) {
          seen.push(new URL(req.url).pathname);
          server.stop(true);
          return new Response("fetch");
        },
      });
      const waiting = [];
      for (const path of ["/api/a", "/api/b", "/"]) {
        waiting.push(get(server, path).catch(() => "closed"));
        // One at a time, so that the server gets them in this order.
        while (server.pendingRequests < waiting.length) await turn();
      }
      gate.resolve();
      const result = { waiting: await Promise.all(waiting), seen };
      // The bundle for "/" was in flight when its client was closed.
      while (server.pendingRequests > 0) await turn();
      console.log(JSON.stringify(result));
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ waiting: ["closed", "closed", "closed"], seen: ["/api/a"] });
  expect(exitCode).toBe(0);
});

// A stopped server goes away with its last request, and that can be one that the dev server is still answering.
test.concurrent.each([
  ["the 404", "", "404 404 Not Found"],
  ["fetch", `fetch: () => new Response("fetch"),`, "200 fetch"],
])("a server that was stopped while a request waited answers it with %s", async (_, fetchHandler, answer) => {
  using dir = tempDir("bake-app-async-plugin-window-stopped", {
    ...routeWritingFiles,
    "fixture.ts": `
      import { get } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const server = serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [{ name: "waits", setup: () => gate.promise }] },
        ${fetchHandler}
      });
      const waiting = [];
      for (const path of ["/api/a", "/api/b"]) {
        waiting.push(get(server, path));
        while (server.pendingRequests < waiting.length) await turn();
      }
      const stopped = server.stop();
      gate.resolve();
      console.log(JSON.stringify({ waiting: await Promise.all(waiting) }));
      await stopped;
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ waiting: [answer, answer] });
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) with no fetch handler answers 404 to a request that waited", async () => {
  using dir = tempDir("bake-app-async-plugin-window-404", {
    ...routeWritingFiles,
    "fixture.ts": `
      import { get } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [{ name: "waits", setup: () => gate.promise }],
        },
      });
      let answered = 0;
      const count = promise => promise.finally(() => answered++);
      const noPage = count(get(server, "/no-page"));
      while (server.pendingRequests + answered < 1) await turn();
      // This client leaves before the setup() settles.
      const leaves = new AbortController();
      const left = count(get(server, "/left", { signal: leaves.signal }).catch(error => error.name));
      while (server.pendingRequests + answered < 2) await turn();
      const held = server.pendingRequests;
      leaves.abort();
      while (server.pendingRequests > 1) await turn();
      gate.resolve();
      const result = { held, left: await left, noPage: await noPage, pending: server.pendingRequests };
      // The page needs a bundle, which takes every request that still waits.
      console.log(JSON.stringify({ ...result, later: await get(server, "/no-page"), page: await get(server, "/") }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({
    held: 2,
    left: "AbortError",
    noPage: "404 404 Not Found",
    pending: 0,
    later: "404 404 Not Found",
    page: "200 ok",
  });
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["a pending plugin setup()", "await turn();"],
  ["synchronous plugin setup() calls", ""],
])("Bun.serve({ app }) reports each route error once with %s", async (_, wait) => {
  using dir = tempDir("bake-app-async-plugin-route-errors", {
    ...routeWritingFiles,
    "routes/[oops.ts": `export default () => new Response("oops");`,
    "routes/about.ts": `export default () => new Response("about");`,
    "routes/about/index.ts": `export default () => new Response("about");`,
    "routes/hidden.ts": `export default () => new Response("a page");`,
    "fixture.ts": `
      import { get, page } from "./pages.ts";
      import { fsr, serve, turn } from "./serve.ts";
      const codegen = {
        name: "codegen",
        async setup() {
          ${wait}
          page("routes/[late.ts", "late");
        },
      };
      const server = serve({
        port: 0,
        development: true,
        routes: { "/hidden": new Response("a route of the server") },
        app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [codegen] },
      });
      console.log(JSON.stringify({ index: await get(server, "/"), hidden: await get(server, "/hidden") }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ index: "200 ok", hidden: "200 a route of the server" });
  const count = (message: string) => stderr.split(message).length - 1;
  expect({
    oops: count('error: "routes/[oops.ts" is not a valid route\n'),
    late: count('error: "routes/[late.ts" is not a valid route\n'),
    ambiguous: count("Multiple pages matching the same route pattern is ambiguous"),
    hidden: count('The server has a route "/hidden", which hides the page routes/hidden.ts'),
  }).toEqual({ oops: 1, late: 1, ambiguous: 1, hidden: 1 });
  expect(exitCode).toBe(0);
});

// A bundle freezes the filters of the plugins, so one that starts before every setup() has finished misses hooks.
const bundleGateFiles = {
  ...pluginSetupFiles,
  "fw/server.ts": `export function render(req, meta) { return meta.pageModule.default(req, meta); }`,
  "fw/client/index.ts": `console.log("client");`,
  "routes/index.ts": `export default () => new Response("from the file");`,
  "plugin.ts": `
    // The plugin that a fixture holds back. Its onLoad() gives the page another body.
    export const held = Promise.withResolvers();
    export const entered = Promise.withResolvers();
    export default {
      name: "held",
      async setup(build) {
        entered.resolve();
        await held.promise;
        build.onLoad({ filter: /routes[\\/\\\\]index\\.ts$/ }, () => ({
          loader: "ts",
          contents: "export default () => new Response('from the plugin');",
        }));
      },
    };
  `,
  "gate.ts": `
    import { writeFileSync } from "node:fs";
    // clientEntryPoint is a directory: the lookup of a file in it makes the dev server watch "fw" before the first bundle.
    export const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./fw/server.ts", clientEntryPoint: "./fw/client" };
    export const get = server => fetch(server.url).then(async res => res.status + " " + (await res.text()).slice(0, 40));
    let saves = 0;
    export const save = () =>
      writeFileSync("fw/server.ts", "export function render(req, meta) { return meta.pageModule.default(req, meta); }\\n// save " + ++saves + "\\n");

    // The dev server's testing protocol. "H" starts a batch of file changes, and "H" again ends it.
    // An "r" frame has a status: 0 the batch started, 1 a change was seen, 2 nothing was bundled, 3 or 4 a bundle finished.
    export async function testingSocket(server) {
      const socket = new WebSocket(new URL("/_bun/hmr", server.url).href.replace("http", "ws"));
      socket.binaryType = "arraybuffer";
      const statuses = [];
      let wake = () => {};
      const subscribed = Promise.withResolvers();
      socket.onmessage = ({ data }) => {
        const [id, status] = new Uint8Array(data);
        const message = String.fromCharCode(id);
        if (message === "V") socket.send("sr"), subscribed.resolve();
        if (message === "r") statuses.push(status), wake();
      };
      await subscribed.promise;
      const next = async () => {
        while (statuses.length === 0) await new Promise(resolve => (wake = resolve));
        return statuses.shift();
      };
      const until = async done => {
        for (;;) {
          const status = await next();
          if (done(status)) return status;
        }
      };
      return {
        close: () => socket.close(),
        // One save in a batch: the result is the status that ends the batch.
        async batchOfOneSave() {
          socket.send("H");
          await until(status => status === 0);
          save();
          // The watcher has delivered every change up to this one.
          await until(status => status === 1);
          socket.send("H");
          return await until(status => status !== 1);
        },
      };
    }
  `,
};

// Only inotify reports a change to a file that no bundle has read yet.
test.concurrent.skipIf(!isLinux)("no bundle starts while a plugin setup() of app.plugins is pending", async () => {
  using dir = tempDir("bake-app-async-plugin-gate-pending", {
    ...bundleGateFiles,
    "fixture.ts": `
      import { fsr, get, save, testingSocket } from "./gate.ts";
      import plugin, { held } from "./plugin.ts";
      import { serve, turn } from "./serve.ts";
      const server = serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [plugin] } });
      const first = get(server);
      while (server.pendingRequests === 0) await turn();
      const hmr = await testingSocket(server);
      // Not in a batch: a bundle for this change would answer the request that waits.
      save();
      const batch = await hmr.batchOfOneSave();
      held.resolve();
      console.log(JSON.stringify({ batch, first: await first, second: await get(server) }));
      hmr.close();
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ batch: 2, first: "200 from the plugin", second: "200 from the plugin" });
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isLinux)("no bundle starts after a plugin setup() of app.plugins has failed", async () => {
  using dir = tempDir("bake-app-async-plugin-gate-failed", {
    ...bundleGateFiles,
    "fixture.ts": `
      import { fsr, get, save, testingSocket } from "./gate.ts";
      import plugin, { held } from "./plugin.ts";
      import { serve, turn } from "./serve.ts";
      const server = serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [plugin] } });
      const first = get(server);
      while (server.pendingRequests === 0) await turn();
      held.reject(new Error("setup failed"));
      const waiting = await first;
      const hmr = await testingSocket(server);
      save();
      const batch = await hmr.batchOfOneSave();
      console.log(JSON.stringify({ waiting, batch, later: await get(server) }));
      hmr.close();
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ waiting: "500 ", batch: 2, later: "200 Plugin Error" });
  expect(stderr).toContain("setup failed");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isLinux).each(["before a request asks for the plugins", "while the plugins load"])(
  "no bundle starts %s of bunfig.toml",
  async when => {
    using dir = tempDir("bake-app-bunfig-plugin-gate", {
      ...bundleGateFiles,
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "fixture.ts": `
        import { fsr, get, save, testingSocket } from "./gate.ts";
        import { entered, held } from "./plugin.ts";
        const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
        let first;
        if (process.env.WHEN === "while the plugins load") {
          first = get(server);
          await entered.promise;
        }
        const hmr = await testingSocket(server);
        save();
        const batch = await hmr.batchOfOneSave();
        first ??= get(server);
        await entered.promise;
        held.resolve();
        console.log(JSON.stringify({ batch, first: await first, second: await get(server) }));
        hmr.close();
        await server.stop(true);
        process.exit(0);
      `,
    });

    const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir), [], { ...bunEnv, WHEN: when });

    expect(result, stderr).toEqual({ batch: 2, first: "200 from the plugin", second: "200 from the plugin" });
    expect(exitCode).toBe(0);
  },
);

// With nothing to wait for, a change before the first request is bundled as before.
test.concurrent.skipIf(!isLinux).each([
  "no plugins",
  "app.plugins with synchronous setup() calls",
  // The dev server does not load the plugins of bunfig.toml when it has app.plugins.
  "app.plugins with synchronous setup() calls, and plugins in bunfig.toml",
])("a testing batch before the first request bundles with %s", async plugins => {
  using dir = tempDir("bake-app-plugin-gate-open", {
    ...bundleGateFiles,
    ...(plugins.endsWith("bunfig.toml") && { "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n` }),
    "fixture.ts": `
      import { fsr, get, testingSocket } from "./gate.ts";
      import { serve } from "./serve.ts";
      const sync = {
        name: "sync",
        setup(build) {
          build.onLoad({ filter: /routes[\\/\\\\]index\\.ts$/ }, () => ({
            loader: "ts",
            contents: "export default () => new Response('from the plugin');",
          }));
        },
      };
      const app = { framework: { fileSystemRouterTypes: [fsr] }, ...(process.env.PLUGINS !== "no plugins" && { plugins: [sync] }) };
      const server = serve({ port: 0, development: true, app });
      const hmr = await testingSocket(server);
      const batch = await hmr.batchOfOneSave();
      console.log(JSON.stringify({ bundled: batch === 3 || batch === 4, first: await get(server) }));
      hmr.close();
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir), [], { ...bunEnv, PLUGINS: plugins });

  const body = plugins === "no plugins" ? "from the file" : "from the plugin";
  expect(result, stderr).toEqual({ bundled: true, first: "200 " + body });
  expect(exitCode).toBe(0);
});
