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

// Both directories hold an `index.ts` and an `about.ts`. The routers can only
// coexist if each one serves its files under its own prefix.
test.concurrent("fileSystemRouterTypes[].prefix mounts each router on its prefix", async () => {
  using dir = tempDir("bake-app-prefix", {
    "framework.ts": `
      export function render(req, meta) {
        return new Response(meta.pageModule.default(meta.params));
      }
    `,
    "routes/index.ts": `export default () => "routes/index.ts";`,
    "routes/about.ts": `export default () => "routes/about.ts";`,
    "routes/blog/[slug].ts": `export default params => "routes/blog/[slug].ts slug=" + params.slug;`,
    "api/index.ts": `export default () => "api/index.ts";`,
    "api/about.ts": `export default () => "api/about.ts";`,
    "api/[...rest].ts": `export default params => "api/[...rest].ts rest=" + params.rest;`,
    "fixture.ts": `
      const router = (root, prefix) => ({ root, prefix, style: "nextjs-pages", serverEntryPoint: "./framework.ts" });
      const server = Bun.serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [router("routes", "/docs"), router("api", "/api/v1/")] } },
        fetch: () => new Response("not a route"),
      });
      const paths = [
        "/docs",
        "/docs/about",
        "/docs/blog/hello",
        "/api/v1",
        "/api/v1/about",
        "/api/v1/a/b",
        "/",
        "/about",
        "/blog/hello",
        "/a/b",
        "/docs/v1/about",
        "/docsabout",
        "/api/about",
      ];
      for (const path of paths) {
        const response = await fetch(new URL(path, server.url));
        console.log(path + " -> " + response.status + " " + (await response.text()));
      }
      await server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: { ...bunEnv, BUN_DEV_SERVER_TEST_RUNNER: "1" },
    cwd: String(dir),
    stdout: "pipe",
    // The dev server logs "Bundled page in 12ms" for each route.
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`
    "/docs -> 200 routes/index.ts
    /docs/about -> 200 routes/about.ts
    /docs/blog/hello -> 200 routes/blog/[slug].ts slug=hello
    /api/v1 -> 200 api/index.ts
    /api/v1/about -> 200 api/about.ts
    /api/v1/a/b -> 200 api/[...rest].ts rest=a,b
    / -> 200 not a route
    /about -> 200 not a route
    /blog/hello -> 200 not a route
    /a/b -> 200 not a route
    /docs/v1/about -> 200 not a route
    /docsabout -> 200 not a route
    /api/about -> 200 not a route
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.serve({ app }) rejects a prefix that no request path can match", async () => {
  using dir = tempDir("bake-app-prefix-invalid", {
    "fixture.ts": `
      const cases = {
        "no leading slash": "docs",
        "empty": "",
        "dot segment": "/docs/./v1",
        "dot dot segment": "/docs/../v1",
        "space": "/my docs",
        "NUL": "/docs\\0",
        "query": "/docs?v=1",
        "fragment": "/docs#v1",
        "backslash": "/docs\\\\v1",
        "non-ASCII": "/d\\u00f6cs",
        "route parameter": "/users/:id",
        "wildcard": "/docs/*",
        "1 MB": "/" + Buffer.alloc(1024 * 1024, "a").toString(),
      };
      for (const [name, prefix] of Object.entries(cases)) {
        const fsr = { root: "routes", prefix, style: "nextjs-pages", serverEntryPoint: "./server.ts" };
        let result;
        try {
          Bun.serve({
            port: 0,
            development: true,
            app: { framework: { fileSystemRouterTypes: [fsr] } },
            fetch: () => new Response(),
          }).stop(true);
          result = "no error";
        } catch (e) {
          result = e.code + ": " + e.message;
        }
        console.log(name + " -> " + result);
      }
      // A directory route with a \`style\` uses its key, without the "/*", as the prefix.
      for (const key of ["/users/:id/*", "/a//b/*", "/my docs/*", "/a/../b/*"]) {
        let result;
        try {
          Bun.serve({
            port: 0,
            development: true,
            routes: { [key]: { dir: "routes", style: "nextjs-pages" } },
            fetch: () => new Response(),
          }).stop(true);
          result = "no error";
        } catch (e) {
          result = e.code + ": " + e.message;
        }
        console.log("routes[" + JSON.stringify(key) + "] -> " + result);
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
    "no leading slash -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' must start with "/"
    empty -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' must start with "/"
    dot segment -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' cannot contain a "." or ".." segment
    dot dot segment -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' cannot contain a "." or ".." segment
    space -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    NUL -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    query -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    fragment -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    backslash -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    non-ASCII -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    route parameter -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    wildcard -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' can only contain printable ASCII characters, and none of ? # \\ : *
    1 MB -> ERR_INVALID_ARG_TYPE: 'fileSystemRouterTypes[0].prefix' is too long
    routes["/users/:id/*"] -> ERR_INVALID_ARG_TYPE: Directory routes do not support :parameters; use a fixed prefix ending in \`/*\`
    routes["/a//b/*"] -> ERR_INVALID_ARG_TYPE: Directory route paths cannot contain empty segments
    routes["/my docs/*"] -> ERR_INVALID_ARG_TYPE: Invalid route "/my docs/*". The path before \`/*\` can only contain printable ASCII characters, and none of ? # \\ : *
    routes["/a/../b/*"] -> ERR_INVALID_ARG_TYPE: Invalid route "/a/../b/*". The path before \`/*\` cannot contain a "." or ".." segment
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
