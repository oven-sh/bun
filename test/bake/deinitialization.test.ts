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

// Every framework dev server evaluates the server runtime through its own
// Bake::SourceProvider, registered in the VM's source map table under the one
// key "bake://server-runtime.js", so the table points at whichever server
// started last. Once that server is torn down and its provider freed, the
// next stack trace through a surviving server's runtime looks the map up via
// the table entry, so the provider must have removed itself by then. Malloc=1
// puts JSC's allocations under the system malloc so ASAN sees the read of the
// freed provider instead of bmalloc quietly handing back the stale memory.
test.skipIf(!isASAN)(
  "tearing down one dev server does not leave its server runtime source provider registered for another",
  async () => {
    using dir = tempDir("bake-deinit-source-provider", {
      "server.ts": `
        export function render(req, meta) {
          return meta.pageModule.default(req, meta);
        }
        export function registerClientReference(value, file, uid) {
          return { value, file, uid };
        }
      `,
      "routes/index.ts": `
        export default function () {
          return new Response(new Error("probe").stack);
        }
      `,
      "fixture.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        import path from "node:path";

        const serverEntryPoint = path.join(import.meta.dir, "server.ts");
        const framework = {
          fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint }],
          serverComponents: {
            separateSSRGraph: false,
            serverRuntimeImportSource: serverEntryPoint,
            serverRegisterClientReferenceExport: "registerClientReference",
          },
        };
        const start = () => Bun.serve({ port: 0, app: { framework } });

        async function collect(isDone) {
          for (let i = 0; i < 200 && !isDone(); i++) {
            Bun.gc(true);
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          if (!isDone()) throw new Error("dev server was not deinitialized");
        }

        const survivor = start();

        // Started second, so its provider replaces the survivor's table entry.
        // Stopped inside its own function so nothing on the stack keeps it alive.
        const deinitsBefore = getDevServerDeinitCount();
        const survivorDebugHooks = globalThis.DEBUG;
        (function startAndStop() {
          start().stop(true);
        })();
        // Debug builds of the server runtime publish globalThis.DEBUG, whose
        // ASSERT is a function of whichever runtime ran last and so would keep
        // the second server's provider alive (release builds compile it out).
        // Put the survivor's back; it is the one that keeps handling requests.
        globalThis.DEBUG = survivorDebugHooks;
        await collect(() => getDevServerDeinitCount() > deinitsBefore);
        // Deinit dropped the dev server's references to the runtime's
        // functions; a few more collections sweep them and free the provider.
        for (let i = 0; i < 5; i++) {
          Bun.gc(true);
          await new Promise(resolve => setTimeout(resolve, 1));
        }

        const response = await fetch(survivor.url);
        const stack = await response.text();
        survivor.stop(true);
        console.log("status:", response.status);
        console.log("runtime frame:", stack.includes("bake://server-runtime.js"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        Malloc: "1",
        // detect_leaks=0: Malloc=1 exposes JSC's process-lifetime startup
        // allocations to LSAN; this test is about the use-after-free.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("AddressSanitizer");
    // The runtime frame is what sends the stack trace through the table entry.
    expect(stdout).toEndWith("status: 200\nruntime frame: true\n");
    expect(exitCode).toBe(0);
  },
  60_000,
);
