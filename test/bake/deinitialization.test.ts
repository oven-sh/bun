import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
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

// The ServerComponentParseTask behind each "use client" reference proxy used to be scheduled and never freed (LSan, so ASAN only).
test.skipIf(!isASAN)(
  'bundling a "use client" reference proxy does not leak its ServerComponentParseTask',
  async () => {
    using dir = tempDir("bake-reference-proxy-leak", {
      "main.ts": `
        using server = Bun.serve({
          port: 0,
          development: true,
          app: {
            framework: {
              serverComponents: {
                separateSSRGraph: true,
                serverRuntimeImportSource: "./framework/server.ts",
                serverRegisterClientReferenceExport: "registerClientReference",
              },
              fileSystemRouterTypes: [
                {
                  root: "routes",
                  serverEntryPoint: "./framework/server.ts",
                  style: "nextjs-pages",
                },
              ],
            },
          },
        });
        const response = await fetch(server.url);
        console.log(response.status, await response.text());
      `,
      "framework/server.ts": `
        export function render(request, meta) {
          return new Response(meta.pageModule.default());
        }
        // Called once per export of the client module by the generated proxy.
        export function registerClientReference(value, file, exportName) {
          return () => file + "#" + exportName;
        }
      `,
      // The proxies, not the modules, run on the server, so Empty's side effect must not be visible to the route.
      "routes/index.ts": `
        import Widget, { Alpha, Beta } from "../components/Widget";
        import "../components/Empty";
        export default () => [Widget(), Alpha(), Beta(), String(globalThis.emptyRanOnServer)].join(" ");
      `,
      "components/Widget.ts": `
        "use client";
        export function Alpha() {}
        export function Beta() {}
        export default function Widget() {}
      `,
      // A client module with no exports gets a proxy with no exports.
      "components/Empty.ts": `
        "use client";
        globalThis.emptyRanOnServer = true;
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(
      "200 components/Widget.ts#default components/Widget.ts#Alpha components/Widget.ts#Beta undefined\n",
    );
    // Unrelated allocations still leak at exit, so only the task's allocation site is asserted on.
    expect(stderr).not.toContain("enqueue_server_component_generated_file");
    expect(proc.signalCode).toBeNull();
  },
  // Bundling under ASAN plus symbolizing a possible LSan report takes a while.
  90_000,
);

test("dev server deinitializes itself when its initialization fails", async () => {
  using dir = tempDir("dev-server-init-failure", {
    // "{" is not valid JSON, so configuring the bundlers fails.
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
  // Under ASAN, LeakSanitizer turns anything the failed servers left behind into a non-zero exit.
  expect(exitCode).toBe(0);
});
