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

// Bun.serve() reads the route directories before it returns, as it does for the plugins of bunfig.toml.
test.concurrent("Bun.serve({ app }) does not route a file that a pending plugin setup() writes later", async () => {
  using dir = tempDir("bake-app-async-plugin-routes", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { writeFileSync } from "node:fs";
      import { fsr, serve, turn } from "./serve.ts";
      const page = name => writeFileSync("routes/" + name + ".ts", "export default () => new Response('" + name + "');");
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [
            { name: "in the call", setup: () => page("first") },
            { name: "after an await", setup: () => turn().then(() => page("generated")) },
            { name: "behind a pending one", setup: () => page("behind") },
          ],
        },
        fetch: () => new Response("no page", { status: 404 }),
      });
      const result = {};
      for (const path of ["/", "/first", "/generated", "/behind"]) {
        const response = await fetch(new URL(path, server.url));
        result[path] = response.status + " " + (await response.text());
      }
      console.log(JSON.stringify(result));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({
    "/": "200 ok",
    "/first": "200 first",
    "/generated": "404 no page",
    "/behind": "404 no page",
  });
  expect(exitCode).toBe(0);
});

// Only a promise makes Bun wait for a setup(). Bun calls no then() that the plugin made.
test.concurrent.each([
  ["calls in the call", "[thenable, ownThen, waits, last]"],
  ["calls behind a pending one", "[waits, thenable, ownThen, last]"],
])("Bun.serve({ app }) treats what a plugin setup() returns alike for %s", async (_, plugins) => {
  using dir = tempDir("bake-app-async-plugin-thenable", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, serve } from "./serve.ts";
      const gate = Promise.withResolvers();
      const calls = [];
      const plugin = (name, setup) => ({ name, setup: () => (calls.push(name), setup()) });
      const waits = plugin("waits", () => gate.promise);
      const thenable = plugin("thenable", () => ({
        then(resolve) {
          calls.push("then() of an object");
          resolve();
        },
      }));
      const ownThen = plugin("own then", () => {
        const promise = Promise.resolve();
        promise.then = function (...reactions) {
          calls.push("then() of a promise");
          return Promise.prototype.then.apply(this, reactions);
        };
        return promise;
      });
      const last = plugin("last", () => {});
      const server = serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: ${plugins} },
      });
      gate.resolve();
      console.log(JSON.stringify({ body: await (await fetch(server.url)).text(), calls: calls.toSorted() }));
      await server.stop(true);
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ body: "ok", calls: ["last", "own then", "thenable", "waits"] });
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
      const result = { resolve: {}, reject: {} };
      for (const settle of ["resolve", "reject"]) {
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
          gate[settle](new Error("rejected after the call threw"));
          await gate.promise.catch(() => {});
          await turn();
          result[settle][name] = ran;
        }
      }
      await taken.stop(true);
      console.log(JSON.stringify({ ...result, pluginCells: pluginCells() - cellsBefore }));
      // The error that was reported would make the exit code 1.
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  const threw = {
    "a plugin behind it is not a plugin": ["ERR_INVALID_ARG_TYPE"],
    "an option behind app is not valid": ["ERR_INVALID_ARG_TYPE"],
    "the dev server does not start": ["Framework is missing required files!"],
    "the port is taken": ["EADDRINUSE"],
    "a plugin of app.plugins is not a plugin": ["ERR_INVALID_ARG_TYPE"],
    "app.plugins is not an array": ["ERR_INVALID_ARG_TYPE"],
    "app.root is not a string": ["ERR_INVALID_ARG_TYPE"],
  };
  expect(result, stderr).toEqual({ resolve: threw, reject: threw, pluginCells: 0 });
  // A call that threw for its options reports nothing later. The server whose port was taken is a server that is gone.
  expect(stderr.split("error: rejected after the call threw").length - 1).toBe(1);
  expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
  expect(exitCode).toBe(0);
});

// then() of a Promise subclass can return a promise that is settled already. Bun.serve() takes it as it is.
test.concurrent("Bun.serve({ app }) takes a settled promise from then() of a plugin setup() promise", async () => {
  using dir = tempDir("bake-app-async-plugin-species", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, serve } from "./serve.ts";
      const result = {};
      for (const [name, settled] of [["fulfilled", () => Promise.resolve()], ["rejected", () => Promise.reject(new Error("from then()"))]]) {
        class Pending extends Promise {
          static get [Symbol.species]() {
            return function (executor) {
              executor(() => {}, () => {});
              return settled();
            };
          }
        }
        try {
          const server = serve({
            port: 0,
            development: true,
            app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: [{ name: "pending", setup: () => new Pending(() => {}) }] },
          });
          result[name] = await (await fetch(server.url)).text();
          await server.stop(true);
        } catch (e) {
          result[name] = "threw: " + e.message;
        }
      }
      console.log(JSON.stringify(result));
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ fulfilled: "ok", rejected: "threw: from then()" });
  expect(exitCode).toBe(0);
});

// then() of a Promise subclass can also throw. That is a setup() that failed, in each position.
test.concurrent.each([
  ["the first setup()", "[throws]"],
  ["a setup() behind a pending one", "[waits, throws]"],
])("Bun.serve({ app }) reports a throw from then() of a plugin setup() promise: %s", async (position, plugins) => {
  using dir = tempDir("bake-app-async-plugin-species-throws", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, serve, turn } from "./serve.ts";
      class Throws extends Promise {
        static get [Symbol.species]() {
          return function () {
            throw new Error("from the constructor");
          };
        }
      }
      const gate = Promise.withResolvers();
      const waits = { name: "waits", setup: () => gate.promise };
      const throws = { name: "throws", setup: () => new Throws(() => {}) };
      let result;
      try {
        const server = serve({
          port: 0,
          development: true,
          app: { framework: { fileSystemRouterTypes: [fsr] }, plugins: ${plugins} },
        });
        const waiting = fetch(server.url);
        while (server.pendingRequests === 0) await turn();
        gate.resolve();
        result = { waiting: (await waiting).status, later: await (await fetch(server.url)).text() };
        await server.stop(true);
      } catch (e) {
        result = { threw: e.message };
      }
      console.log(JSON.stringify(result));
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  if (position === "the first setup()") {
    expect(result, stderr).toEqual({ threw: "from the constructor" });
  } else {
    expect(result, stderr).toEqual({ waiting: 500, later: "Plugin Error" });
    expect(stderr.split("Failed to load plugins for Bun.serve:").length - 1).toBe(1);
    expect(stderr).toContain("from the constructor");
  }
  expect(exitCode).toBe(0);
});

// The dev server has the plugin. They go together: at stop(true), or at stop() when nothing is in flight.
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

// stop() lets a request that is in flight finish. Its page needs every setup().
test.concurrent("server.stop() with a request in flight lets the plugin setup() calls finish", async () => {
  using dir = tempDir("bake-app-async-plugin-stop-in-flight", {
    ...pluginSetupFiles,
    "fixture.ts": `
      import { fsr, pluginCells, serve, turn } from "./serve.ts";
      const gate = Promise.withResolvers();
      const ran = [];
      const cellsBefore = pluginCells();
      const server = serve({
        port: 0,
        development: true,
        app: {
          framework: { fileSystemRouterTypes: [fsr] },
          plugins: [{ name: "waits", setup: () => gate.promise }, { name: "behind", setup: () => void ran.push("behind") }],
        },
      });
      const waiting = fetch(server.url);
      while (server.pendingRequests === 0) await turn();
      const stopped = server.stop();
      gate.resolve();
      const body = await (await waiting).text();
      await stopped;
      // The client keeps its connection open. This closes it, so that the exit has nothing to wait for.
      await server.stop(true);
      console.log(JSON.stringify({ body, ran, pluginCells: pluginCells() - cellsBefore }));
      process.exit(0);
    `,
  });

  const { result, stderr, exitCode } = await runPluginSetupFixture(String(dir));

  expect(result, stderr).toEqual({ body: "ok", ran: ["behind"], pluginCells: 0 });
  expect(exitCode).toBe(0);
});

test.concurrent("server.stop(true) frees the plugin and ends the setup() calls that are left", async () => {
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
        for (const state of ["loaded", "loaded and stopped", "pending", "pending with a request", "pending and stopped"]) {
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
          if (state.endsWith("with a request")) {
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

    expect({ result, exitCode }, stderr).toEqual({ result: { servers: 5 }, exitCode: 0 });
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
