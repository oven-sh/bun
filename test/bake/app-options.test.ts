import { expect, test } from "bun:test";
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
