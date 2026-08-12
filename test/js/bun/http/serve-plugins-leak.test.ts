import { expect, test } from "bun:test";
import { bunEnv, bunRun, isWindows } from "harness";
import { join } from "node:path";

// Each Bun.serve() that loads `[serve.static]` plugins creates one native
// BundlerPlugin cell (a protected JSCell) for them. ServePlugins used to drop
// its handle to that cell without ever unprotecting it, so every server that
// had loaded its plugins (whether the load succeeded or not) left the cell, and
// everything the plugin callbacks captured, rooted for the rest of the process.
// The fixtures also cover Bun.build(), whose per-build cell must be released
// once the build is done, since both now share the same owning handle.
//
// The fixtures run with their own directory as cwd (bunRun), which is where
// the bunfig.toml that configures the plugin lives.
const fixture = (name: string) => join(import.meta.dir, "serve-plugins-leak-fixture", name);

test.concurrent("[serve.static] plugins and Bun.build() plugins release their BundlerPlugin cell", async () => {
  const result = await bunRun(fixture("serve-plugins-leak-fixture.ts"));
  expect(result).toSpawn();
  expect(JSON.parse(result.stdout)).toEqual({
    // One setup() for the build, one per server (two served to completion, one stopped mid-build).
    setups: 4,
    buildUsedPlugin: true,
    buildCellsAfter: 0,
    serveUsedPlugin: 2,
    cellsWhileServing: 2,
    serveCellsAfter: 0,
    stopMidBuildStatus: 200,
    stopMidBuildCellsAfter: 0,
  });
});

test.concurrent("the dev server's [serve.static] plugins release their BundlerPlugin cell too", async () => {
  const result = await bunRun(fixture("serve-plugins-dev-server-fixture.ts"));
  expect({
    ...result,
    stdout: JSON.parse(result.stdout),
    // The dev server reports every bundle on stderr.
    stderr: result.stderr.replaceAll(/\d+ms/g, "<n>ms"),
  }).toEqual({
    stdout: { setups: 2, usedPlugin: 2, cellsWhileServing: 2, cellsAfter: 0 },
    stderr: "Bundled page in <n>ms: index.html\nBundled page in <n>ms: index.html",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("a [serve.static] plugin load that rejects releases its BundlerPlugin cell", async () => {
  const { stderr, ...result } = await bunRun(fixture("serve-plugins-reject-fixture.ts"), {
    SERVE_PLUGIN_SETUP_THROWS: "1",
  });
  expect({ ...result, stdout: JSON.parse(result.stdout) }).toEqual({
    stdout: { setups: 1, status: 500, protectedCellsAfterReject: 0 },
    exitCode: 0,
    signalCode: null,
  });
  expect(stderr).toContain("Failed to load plugins for Bun.serve:");
  expect(stderr).toContain("setup() failed on purpose");
});

// VM teardown cancels a route build that is still parked in the plugin. That
// build only borrows the server's cell, so giving the task up must not release
// or touch anything the server still owns. BUN_DESTRUCT_VM_ON_EXIT makes
// process.exit() actually tear the VM down; Malloc=1 puts JSC cells under the
// system allocator so the debug/ASAN build would see a use of a released cell
// (and, as in the other tests that set it, leak detection is turned off because
// it then reports JSC's process-lifetime allocations).
test.concurrent("exiting while an HTML route build is parked in the server's plugins tears down cleanly", async () => {
  const result = await bunRun(fixture("serve-plugins-exit-mid-build-fixture.ts"), {
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ...(isWindows
      ? {}
      : { Malloc: "1", ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") }),
  });
  expect(result).toSpawn("build parked in the plugin, exiting");
});
