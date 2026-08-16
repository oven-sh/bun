// Parsing of the `app` option of `Bun.serve({ app })` (src/runtime/bake/bake_body.rs,
// UserOptions::from_js). The dev server strips `app.root` off absolute file paths to build
// route patterns and module IDs, so the value the user passes has to be resolved against
// the working directory and normalized before it gets there.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    expect(JSON.parse(line!)).toEqual({ status: 200, body: "index route" });
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
    expect(JSON.parse(stdout)).toEqual({
      "root: null": "accepted",
      "root: 123": 'The "root" property must be of type string, got number',
      // The limit is the platform's path buffer size (1024 on macOS, 4096 on Linux, larger on Windows).
      "root: 100k chars": expect.stringMatching(/^'app\.root' resolves to a path longer than \d+ bytes$/),
      "plugins[0].name: 123": 'The "name" property must be of type string, got number',
      "serverComponents.serverRuntimeImportSource: 123":
        'The "serverRuntimeImportSource" property must be of type string, got number',
      "serverComponents.serverRegisterClientReferenceExport: 123":
        'The "serverRegisterClientReferenceExport" property must be of type string, got number',
    });
    expect(exitCode).toBe(0);
  });
});
