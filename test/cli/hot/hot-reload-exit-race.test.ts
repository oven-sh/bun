import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Regression for the watcher-vs-exit race observed on the x64-asan CI lane.
// A watcher thread dispatching through the resolver's BSSMap singletons
// (dir_cache, etc.) can touch that memory after `VirtualMachine.globalExit`
// frees it in `transpiler.deinit()`, aborting with use-after-poison from
// thread T2 (File Watcher):
//
//   #3 bun_alloc.BSSMap.BSSMapType.remove
//   #4 resolver.Resolver.bustDirCache
//   #5 jsc.VirtualMachine.bustDirCache
//   #6 jsc.hot_reloader.NewHotReloader.onFileUpdate
//   #7 watcher.INotifyWatcher.processINotifyEventBatch
//   #8 watcher.Watcher.threadMain
//
// The race is microseconds wide in production and is hard to trigger from
// user-space alone, so the test uses three debug-build internal env vars
// to force it deterministically:
//
//  - `BUN_INTERNAL_WATCHER_WATCH_ENTRYPOINT_DIR`: have --hot also watch
//    the entrypoint's directory so sibling-file create/delete events fire
//    the `.directory` branch of `onFileUpdate` → `bustDirCache`.
//  - `BUN_INTERNAL_WATCHER_BUSTDIRCACHE_DELAY_MS`: make
//    `VirtualMachine.bustDirCache` sleep under the watcher's mutex, so the
//    main thread has time to race ahead and free the singleton.
//  - `BUN_INTERNAL_GLOBALEXIT_FAST_PATH_TO_TRANSPILER_DEINIT` +
//    `BUN_INTERNAL_GLOBALEXIT_LINGER_MS`: cut the main thread's
//    globalExit straight to `transpiler.deinit()` (frees the BSSMap) and
//    then linger in `Global.exit` long enough for the watcher's sleep to
//    end and touch the now-poisoned memory.
//
// All four env vars are gated on `comptime bun.Environment.allow_assert`
// (debug builds) so they do nothing in canary/release.
test.skipIf(!isASAN)(
  "--hot exits cleanly while watcher is dispatching bustDirCache",
  async () => {
    using dir = tempDir("hot-exit-race", {
      "script.ts":
        // The entrypoint just needs to run --hot and then ask to exit.
        // The dir-watch hook adds the entrypoint's directory to the
        // watcher; the setInterval keeps dir events flowing at the watcher
        // throughout, so when setTimeout fires the watcher is almost
        // certainly sleeping inside bustDirCache's delay hook.
        `import { writeFileSync } from "node:fs";\n` +
        `console.log("READY");\n` +
        `setInterval(() => { try { writeFileSync("./x" + ((Math.random() * 16) | 0), "x"); } catch {} }, 1);\n` +
        `setTimeout(() => process.exit(0), 300);\n` +
        `setInterval(() => {}, 10_000);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "run", "script.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        BUN_INTERNAL_WATCHER_WATCH_ENTRYPOINT_DIR: "1",
        BUN_INTERNAL_WATCHER_BUSTDIRCACHE_DELAY_MS: "50",
        BUN_INTERNAL_GLOBALEXIT_FAST_PATH_TO_TRANSPILER_DEINIT: "1",
        BUN_INTERNAL_GLOBALEXIT_LINGER_MS: "200",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for READY — --hot initialized and the dir watch is active.
    let stdout = "";
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (!stdout.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const exitCode = await Promise.race([proc.exited, Bun.sleep(5_000).then(() => null)]);
    const stderr = await proc.stderr.text();

    if (exitCode !== 0 || proc.signalCode !== null) {
      console.error(`exitCode=${exitCode}, signal=${proc.signalCode}, stderr:\n${stderr}`);
    }
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stderr).not.toContain("use-after-poison");
    expect(proc.signalCode).not.toBe("SIGABRT");
    expect(exitCode).toBe(0);
  },
  30_000,
);
