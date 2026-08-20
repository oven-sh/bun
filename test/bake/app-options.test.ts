// Parsing of the `app` option shared by `Bun.serve({ app })` and `bun build --app` (src/runtime/bake/bake_body.rs).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, MAX_PATH_BYTES, tempDir } from "harness";
import path from "node:path";

test("optional app keys treat null as absent", async () => {
  using dir = tempDir("bake-app-options", {
    "server.ts": `export function render() { return new Response("unused"); }`,
    "check.ts": `
      import path from "node:path";
      const framework = {
        fileSystemRouterTypes: [
          { root: path.join(import.meta.dir, "routes"), style: "nextjs-pages", serverEntryPoint: "./server.ts" },
        ],
      };
      const serverComponents = value => ({ framework: { ...framework, serverComponents: { separateSSRGraph: value } } });
      const apps = {
        "bundlerOptions: null": { framework, bundlerOptions: null },
        "bundlerOptions.{server,client,ssr}: null": { framework, bundlerOptions: { server: null, client: null, ssr: null } },
        "bundlerOptions.client.sourcemap: null": { framework, bundlerOptions: { client: { sourcemap: null } } },
        "bundlerOptions.client.sourcemap: 0": { framework, bundlerOptions: { client: { sourcemap: 0 } } },
        "bundlerOptions.client.minify: null": { framework, bundlerOptions: { client: { minify: null } } },
        "bundlerOptions.client.{conditions,define,drop,ignoreDCEAnnotations}: null": {
          framework,
          bundlerOptions: { client: { conditions: null, define: null, drop: null, ignoreDCEAnnotations: null } },
        },
        "framework.bundlerOptions: null": { framework: { ...framework, bundlerOptions: null } },
        "framework.staticRouters: null": { framework: { ...framework, staticRouters: null } },
        "framework.plugins: null": { framework: { ...framework, plugins: null } },
        "serverComponents.separateSSRGraph: null": serverComponents(null),
        "serverComponents.separateSSRGraph: 0": serverComponents(0),
        // false is a value, not "absent": parsing moves on to the next required key.
        "serverComponents.separateSSRGraph: false": serverComponents(false),
      };

      const results = {};
      for (const [name, app] of Object.entries(apps)) {
        try {
          const server = Bun.serve({ port: 0, development: true, app, fetch: () => new Response("") });
          server.stop(true);
          results[name] = "accepted";
        } catch (e) {
          results[name] = e.message;
        }
      }
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toStrictEqual({
    "bundlerOptions: null": "accepted",
    "bundlerOptions.{server,client,ssr}: null": "accepted",
    "bundlerOptions.client.sourcemap: null": "accepted",
    "bundlerOptions.client.sourcemap: 0":
      'The "sourcemap" property must be of type "none" | "inline" | "external" | "linked", got number',
    "bundlerOptions.client.minify: null": "accepted",
    "bundlerOptions.client.{conditions,define,drop,ignoreDCEAnnotations}: null": "accepted",
    "framework.bundlerOptions: null": "accepted",
    "framework.staticRouters: null": "accepted",
    "framework.plugins: null": "accepted",
    "serverComponents.separateSSRGraph: null": "Missing 'framework.serverComponents.separateSSRGraph'",
    "serverComponents.separateSSRGraph: 0": "'framework.serverComponents.separateSSRGraph' must be a boolean",
    "serverComponents.separateSSRGraph: false": "Missing 'framework.serverComponents.serverRuntimeImportSource'",
  });
  expect(exitCode).toBe(0);
});

test("bundlerOptions values are validated while parsing the options", async () => {
  using dir = tempDir("bake-app-bundler-options", {
    "server.ts": `export function render() { return new Response("unused"); }`,
    // Stand-ins for the two framework imports `Bun.serve` resolves up front, so the in-tree React framework object loads without a React install.
    "node_modules/react-refresh/runtime.js": `export {};`,
    "node_modules/react-server-dom-bun/server.js": `export {};`,
    "check.ts": `
      import path from "node:path";
      import { react } from ${JSON.stringify(path.join(import.meta.dir, "../../src/runtime/bake/bun-framework-react/index.ts"))};
      const framework = {
        fileSystemRouterTypes: [
          { root: path.join(import.meta.dir, "routes"), style: "nextjs-pages", serverEntryPoint: "./server.ts" },
        ],
      };
      const client = value => ({ framework, bundlerOptions: { client: value } });
      const apps = {
        "bundlerOptions: 42": { framework, bundlerOptions: 42 },
        "bundlerOptions.server: 'str'": { framework, bundlerOptions: { server: "str" } },
        // Only the per-graph objects are read, so a top-level key is rejected instead of ignored.
        "bundlerOptions.define: {}": { framework, bundlerOptions: { define: {} } },
        "client.conditions: ['a', 'b']": client({ conditions: ["a", "b"] }),
        "client.conditions: 'a'": client({ conditions: "a" }),
        "client.conditions: 3": client({ conditions: 3 }),
        "client.define: { 'globalThis.X': '1' }": client({ define: { "globalThis.X": "1" } }),
        "client.define: 'str'": client({ define: "str" }),
        "client.define: { X: 3 }": client({ define: { X: 3 } }),
        "client.drop: ['console']": client({ drop: ["console"] }),
        "client.drop: 'console'": client({ drop: "console" }),
        "client.ignoreDCEAnnotations: true": client({ ignoreDCEAnnotations: true }),
        "client.minify: false": client({ minify: false }),
        "client.minify: { syntax: false, keepNames: true }": client({ minify: { syntax: false, keepNames: true } }),
        "client.minify: 7": client({ minify: 7 }),
        "client.sourcemap: 'none'": client({ sourcemap: "none" }),
        "client.sourcemap: true": client({ sourcemap: true }),
        // No per-graph loader map or plugin list exists yet.
        "client.loader: {}": client({ loader: {} }),
        "client.plugins: []": client({ plugins: [] }),
        "framework.bundlerOptions.ssr.drop: ['console']": {
          framework: { ...framework, bundlerOptions: { ssr: { drop: ["console"] } } },
        },
        "framework.bundlerOptions.ssr: 7": { framework: { ...framework, bundlerOptions: { ssr: 7 } } },
        "framework.staticRouters: []": { framework: { ...framework, staticRouters: [] } },
        "bun-framework-react/index.ts react()": { framework: react() },
      };

      const results = {};
      for (const [name, app] of Object.entries(apps)) {
        try {
          const server = Bun.serve({ port: 0, development: true, app, fetch: () => new Response("") });
          server.stop(true);
          results[name] = "accepted";
        } catch (e) {
          results[name] = e.message;
        }
      }
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toStrictEqual({
    "bundlerOptions: 42": "'bundlerOptions' must be an object",
    "bundlerOptions.server: 'str'": "'bundlerOptions.server' must be an object",
    "bundlerOptions.define: {}":
      "'bundlerOptions.define' must be set under 'bundlerOptions.client', '.server' or '.ssr'",
    "client.conditions: ['a', 'b']": "accepted",
    "client.conditions: 'a'": "accepted",
    "client.conditions: 3": "'bundlerOptions.client.conditions' must be a string or an array of strings",
    "client.define: { 'globalThis.X': '1' }": "accepted",
    "client.define: 'str'": "'bundlerOptions.client.define' must be an object",
    "client.define: { X: 3 }": `'bundlerOptions.client.define["X"]' must be a string`,
    "client.drop: ['console']": "accepted",
    "client.drop: 'console'": "'bundlerOptions.client.drop' must be an array of strings",
    "client.ignoreDCEAnnotations: true": "accepted",
    "client.minify: false": "accepted",
    "client.minify: { syntax: false, keepNames: true }": "accepted",
    "client.minify: 7": "'bundlerOptions.client.minify' must be a boolean or an object",
    "client.sourcemap: 'none'": "accepted",
    "client.sourcemap: true":
      'The "sourcemap" property must be of type "none" | "inline" | "external" | "linked", got boolean',
    "client.loader: {}": "'bundlerOptions.client.loader' is not supported yet",
    "client.plugins: []": "'bundlerOptions.client.plugins' is not supported yet",
    "framework.bundlerOptions.ssr.drop: ['console']": "accepted",
    "framework.bundlerOptions.ssr: 7": "'framework.bundlerOptions.ssr' must be an object",
    "framework.staticRouters: []": "'framework.staticRouters' is not supported yet",
    "bun-framework-react/index.ts react()": "accepted",
  });
  expect(exitCode).toBe(0);
});

const appFiles = {
  "server.ts": `export function render(req, meta) { return meta.pageModule.default(); }`,
  "routes/index.ts": `export default () => new Response("index route");`,
};

const framework = `{
  fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
}`;

describe("app.root", () => {
  // `root` defaults to the cwd; every other spelling below names that same directory.
  const spellings: (string | undefined)[] = [undefined, "", ".", "./", "routes/..", "<cwd>/"];
  test.concurrent.each(spellings)("routes are served when root is %p", async spelling => {
    using dir = tempDir("bake-app-root", {
      ...appFiles,
      "serve.ts": `
        const { root } = JSON.parse(process.argv[2]);
        const server = Bun.serve({
          port: 0,
          development: true,
          app: { framework: ${framework}, root: root?.replace("<cwd>", process.cwd()) },
          fetch: () => new Response("fallback"),
        });
        const res = await fetch(server.url);
        console.log(JSON.stringify({ status: res.status, body: await res.text() }));
        await server.stop(true);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve.ts", JSON.stringify({ root: spelling })],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("{"));
    expect(line, stderr).toBeDefined();
    expect(JSON.parse(line!)).toStrictEqual({ status: 200, body: "index route" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("values that cannot be used as a root are rejected while parsing the options", async () => {
    using dir = tempDir("bake-app-root-invalid", {
      ...appFiles,
      "check.ts": `
        const framework = ${framework};
        const serverComponents = extra => ({
          framework: { ...framework, serverComponents: { separateSSRGraph: false, ...extra } },
        });
        const apps = {
          "root: null": { framework, root: null },
          "root: 123": { framework, root: 123 },
          "root: 100k chars": { framework, root: Buffer.alloc(100_000, "a").toString() },
          // The same string check applies to the other optional string options.
          "plugins[0].name: 123": { framework, plugins: [{ name: 123, setup() {} }] },
          "serverComponents.serverRuntimeImportSource: 123": serverComponents({ serverRuntimeImportSource: 123 }),
          "serverComponents.serverRegisterClientReferenceExport: 123": serverComponents({
            serverRuntimeImportSource: "./server.ts",
            serverRegisterClientReferenceExport: 123,
          }),
          "fileSystemRouterTypes[0].ignoreDirs: string": {
            framework: { fileSystemRouterTypes: [{ ...framework.fileSystemRouterTypes[0], ignoreDirs: "hidden" }] },
          },
        };

        const results = {};
        for (const [name, app] of Object.entries(apps)) {
          try {
            const server = Bun.serve({ port: 0, development: true, app, fetch: () => new Response("") });
            server.stop(true);
            results[name] = "accepted";
          } catch (e) {
            results[name] = e.message;
          }
        }
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toStrictEqual({
      "root: null": "accepted",
      "root: 123": 'The "root" property must be of type string, got number',
      "root: 100k chars": `'app.root' must resolve to a path shorter than ${MAX_PATH_BYTES} bytes`,
      "plugins[0].name: 123": 'The "name" property must be of type string, got number',
      "serverComponents.serverRuntimeImportSource: 123":
        'The "serverRuntimeImportSource" property must be of type string, got number',
      "serverComponents.serverRegisterClientReferenceExport: 123":
        'The "serverRegisterClientReferenceExport" property must be of type string, got number',
      "fileSystemRouterTypes[0].ignoreDirs: string": "'ignoreDirs' must be an array of strings",
    });
    expect(exitCode).toBe(0);
  });
});
