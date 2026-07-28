import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The runtime auto-installer waits for the registry round-trip inside
// PackageManager::sleep_until. That wait must not drain JS tasks or
// microtasks: the resolver can be on the stack underneath
// HostLoadImportedModule (inside JSC's innerModuleLoading walk), and a nested
// microtask drain there lets a sibling request's FinishLoadingImportedModule
// mutate [[LoadedModules]] mid-walk, tripping the needsErrorReaction
// assertion on debug builds and dropping the ModuleGraphLoadingError reaction
// on release builds.
//
// Observed directly here via Bun.resolveSync: it is a synchronous call, so a
// microtask or immediate that runs before it returns was drained by the
// auto-install wait loop, not by the caller.
test("auto-install wait does not drain microtasks or immediates (Bun.resolveSync)", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  // No node_modules in the tree → the bare specifier reaches the auto-install
  // path and enqueues a manifest fetch against the local 404 server above.
  using dir = tempDir("resolve-autoinstall-eventloop", {
    "index.js": `
      let microtaskFired = "no";
      let nextTickFired = "no";
      let immediateFired = "no";
      queueMicrotask(() => { microtaskFired = "yes"; });
      process.nextTick(() => { nextTickFired = "yes"; });
      setImmediate(() => { immediateFired = "yes"; });

      let threw = "no";
      try {
        Bun.resolveSync("a-pkg-that-does-not-exist-on-the-registry", import.meta.dir);
      } catch {
        threw = "yes";
      }

      console.log(JSON.stringify({ microtaskFired, nextTickFired, immediateFired, threw }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    microtaskFired: "no",
    nextTickFired: "no",
    immediateFired: "no",
    threw: "yes",
  });
  expect(exitCode).toBe(0);
});
