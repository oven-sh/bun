// Parsing of the `app` option shared by `Bun.serve({ app })` and `bun build --app` (src/runtime/bake/bake_body.rs).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    "framework.plugins: null": "accepted",
    "serverComponents.separateSSRGraph: null": "Missing 'framework.serverComponents.separateSSRGraph'",
    "serverComponents.separateSSRGraph: 0": "'framework.serverComponents.separateSSRGraph' must be a boolean",
    "serverComponents.separateSSRGraph: false": "Missing 'framework.serverComponents.serverRuntimeImportSource'",
  });
  expect(exitCode).toBe(0);
});
