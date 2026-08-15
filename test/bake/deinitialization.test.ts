import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

test("dev server deinitializes itself", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "fixtures/deinitialization/test.ts")],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
  // The child runs a whole `bun test` suite (nine GC-heavy cases plus leak
  // reporting at exit), which takes longer than the 5s default under ASAN.
}, 60_000);

test("dev server deinitializes itself when its initialization fails", async () => {
  using dir = tempDir("dev-server-init-failure", {
    // The define's value is parsed while the dev server configures its
    // bundlers, which is where this one fails: "{" is not valid JSON.
    "bunfig.toml": `[serve.static]\ndefine = { "BROKEN_DEFINE" = "{" }\n`,
    "index.html": `<!DOCTYPE html><html><body><script src="./app.ts"></script></body></html>`,
    "app.ts": `console.log(BROKEN_DEFINE);`,
    "init-failure-fixture.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import html from "./index.html";

      function serveAndFail(options) {
        const before = getDevServerDeinitCount();
        let message = "Bun.serve() did not throw";
        try {
          Bun.serve({ port: 0, development: true, fetch: () => new Response("unreachable"), ...options }).stop(true);
        } catch (e) {
          message = e.message;
        }
        return { message, deinits: getDevServerDeinitCount() - before };
      }

      console.log(
        JSON.stringify({
          // Fails while the per-graph bundlers are configured (the bunfig define).
          bundlerConfig: serveAndFail({ routes: { "/": html } }),
          // Gets further: fails when the framework's entry points are resolved.
          frameworkResolve: serveAndFail({
            app: {
              framework: {
                fileSystemRouterTypes: [{ root: "pages", style: "nextjs-pages", serverEntryPoint: "./missing-entry.ts" }],
              },
            },
          }),
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "init-failure-fixture.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Each failed Bun.serve() must tear down the dev server it was building.
  expect(JSON.parse(stdout)).toEqual({
    bundlerConfig: { message: "ParserError while initializing development server", deinits: 1 },
    frameworkResolve: { message: "Framework is missing required files!", deinits: 1 },
  });
  expect(stderr).toContain("Failed to resolve './missing-entry.ts' for framework (server side entrypoint)");
  // Under ASAN, LeakSanitizer turns anything the failed servers left behind
  // into a non-zero exit here.
  expect(exitCode).toBe(0);
  // The child's LeakSanitizer pass at exit alone takes a few seconds under ASAN.
}, 30_000);
