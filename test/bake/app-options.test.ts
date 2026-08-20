// Parsing of the `app` option shared by `Bun.serve({ app })` and `bun build --app` (src/runtime/bake/bake_body.rs).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, MAX_PATH_BYTES, tempDir } from "harness";

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
        // Documented keys that are not wired up yet fail loudly instead of doing nothing.
        "bundlerOptions.client.conditions: []": { framework, bundlerOptions: { client: { conditions: [] } } },
        "bundlerOptions.define: {}": { framework, bundlerOptions: { define: {} } },
        "framework.bundlerOptions: {}": { framework: { ...framework, bundlerOptions: {} } },
        "framework.staticRouters: []": { framework: { ...framework, staticRouters: [] } },
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
      'The "sourcemap" property must be of type "inline" | "external" | "linked", got number',
    "bundlerOptions.client.minify: null": "accepted",
    "bundlerOptions.client.conditions: []": "'bundlerOptions.client.conditions' is not supported yet",
    "bundlerOptions.define: {}":
      "'bundlerOptions.define' must be set under 'bundlerOptions.client', '.server' or '.ssr'",
    "framework.bundlerOptions: {}": "'framework.bundlerOptions' is not supported yet",
    "framework.staticRouters: []": "'framework.staticRouters' is not supported yet",
    "framework.plugins: null": "accepted",
    "serverComponents.separateSSRGraph: null": "Missing 'framework.serverComponents.separateSSRGraph'",
    "serverComponents.separateSSRGraph: 0": "'framework.serverComponents.separateSSRGraph' must be a boolean",
    "serverComponents.separateSSRGraph: false": "Missing 'framework.serverComponents.serverRuntimeImportSource'",
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
