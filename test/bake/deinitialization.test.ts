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

// With separateSSRGraph, every "use client" module the server graph imports
// makes the bundler generate a "reference proxy" module in its place. The
// proxy is built on the thread pool from a heap-allocated
// ServerComponentParseTask, which used to be scheduled and never freed (one
// per client module per bundle). LeakSanitizer reports the task at exit, so
// this needs the ASAN build. The rendered output checks what the task hands
// to the generator: the client module's path and its export names, which the
// proxy passes to registerClientReference.
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
      // The server graph imports both client modules, so it gets a proxy for
      // each: the proxies, not the modules, run on the server, which is why
      // Empty's side effect must not be visible to the route.
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(
      "200 components/Widget.ts#default components/Widget.ts#Alpha components/Widget.ts#Beta undefined\n",
    );
    // The dev server logs its bundle timing here; a leak report would follow it.
    expect(stderr).not.toContain("LeakSanitizer");
    expect(exitCode).toBe(0);
  },
  // Starting a dev server and bundling the route takes a few seconds under
  // ASAN, and when LSan does find something, symbolizing the report against
  // the debug binary takes longer still.
  90_000,
);
