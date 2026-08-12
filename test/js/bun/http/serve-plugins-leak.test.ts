import { expect, test } from "bun:test";
import { bunEnv, bunRun, isWindows } from "harness";
import { join } from "node:path";

// Each Bun.serve() that loads `[serve.static]` plugins creates one native
// BundlerPlugin cell (a protected JSCell) for them. ServePlugins used to drop
// its handle to that cell without ever unprotecting it, so every server that
// had served an HTML route left its plugin cell, and everything the plugin
// callbacks captured, rooted for the rest of the process. The fixture also
// covers Bun.build(), whose per-build cell must be released once the build is
// done, since both now share the same owning handle.
//
// The fixtures run with their own directory as cwd (bunRun), which is where
// the bunfig.toml that configures the plugin lives.
const fixtures = join(import.meta.dir, "serve-plugins-leak-fixture");

test.concurrent("[serve.static] plugins and Bun.build() plugins release their BundlerPlugin cell", async () => {
  const result = await bunRun(join(fixtures, "serve-plugins-leak-fixture.ts"));
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

// VM teardown cancels a route build that is still parked in the plugin. That
// build only borrows the server's cell, so giving the task up must not release
// or touch anything the server still owns. BUN_DESTRUCT_VM_ON_EXIT makes
// process.exit() actually tear the VM down; Malloc=1 puts JSC cells under the
// system allocator so the debug/ASAN build would see a use of a released cell
// (and, as in the other tests that set it, leak detection is turned off because
// it then reports JSC's process-lifetime allocations).
test.concurrent("exiting while an HTML route build is parked in the server's plugins tears down cleanly", async () => {
  const result = await bunRun(join(fixtures, "serve-plugins-exit-mid-build-fixture.ts"), {
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ...(isWindows
      ? {}
      : { Malloc: "1", ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") }),
  });
  expect(result).toSpawn("build parked in the plugin, exiting");
});
