import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// Regression for the watcher-vs-exit race observed on the x64-asan CI lane.
// A file-watcher thread dispatching through the resolver's BSSMap singletons
// (the module-resolution dir cache, etc.) can touch that memory after the
// exit path frees it — `transpiler.deinit()` on the BUN_DESTRUCT_VM_ON_EXIT
// path, ASAN's `libc_exit` teardown otherwise — aborting with use-after-poison
// from the "File Watcher" thread:
//
//   bust_dir_cache                (resolver BSSMap::remove)
//   VirtualMachine::bust_dir_cache
//   NewHotReloader::on_file_update
//   process_inotify_event_batch   (File Watcher thread)
//
// The fix stops every watcher (under its own mutex, which serialises with the
// thread's on_file_update dispatch) before the teardown frees that memory:
// `Watcher::stop_all_for_exit`, called from `VirtualMachine::global_exit`
// before `destroy()` and from `Global::exit` via an early-exit hook.
//
// The race is microseconds wide in production and can't be hit from user-space
// alone, so this test uses three debug-build internal env vars to force it:
//
//  - BUN_INTERNAL_WATCHER_BUSTDIRCACHE_DELAY_MS: make
//    `VirtualMachine::bust_dir_cache` sleep under the watcher's mutex, so the
//    main thread has time to race ahead and free the singleton.
//  - BUN_INTERNAL_GLOBALEXIT_FAST_PATH_TO_TRANSPILER_DEINIT: cut
//    `global_exit` straight to `destroy()` (frees the BSSMap), skipping the
//    worker/socket drains, so the free happens while the watcher still sleeps.
//  - BUN_INTERNAL_GLOBALEXIT_LINGER_MS: linger in `Global::exit` after the
//    teardown so the watcher's delayed bust_dir_cache lands on freed memory.
//
// All three are gated on `cfg(debug_assertions)` so they do nothing in
// canary/release. The entrypoint's own directory is watched by --hot (the
// parent-directory auto-watch in `append_file_maybe_lock`), so writing sibling
// files in it fires the `.directory` branch of `on_file_update` →
// `bust_dir_cache` — no extra hook needed to reach the crash site.
//
// Requires BOTH ASAN (to catch the use-after-free) and a debug-assertions
// build (for the hooks above): `bun-debug` / any debug-ASAN build. The CI
// release-ASAN binary (`bun-asan`) has `debug_assertions` off — the hooks
// compile out there — so skip rather than pass vacuously.
test.skipIf(!isASAN || !isDebug)(
  "--hot exits cleanly while watcher is dispatching bust_dir_cache",
  async () => {
    using dir = tempDir("hot-exit-race", {
      "script.ts":
        `import { writeFileSync } from "node:fs";\n` +
        `console.log("READY");\n` +
        // Keep directory events flowing at the watcher throughout, so when the
        // exit fires the watcher is almost certainly sleeping inside
        // bust_dir_cache's delay hook. Writes land in the entrypoint's own
        // (watched) directory.
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
        BUN_INTERNAL_WATCHER_BUSTDIRCACHE_DELAY_MS: "50",
        BUN_INTERNAL_GLOBALEXIT_FAST_PATH_TO_TRANSPILER_DEINIT: "1",
        BUN_INTERNAL_GLOBALEXIT_LINGER_MS: "200",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // The script prints READY, churns the watched directory for ~300ms, then
    // exits. Collect everything and wait for exit — without the fix the File
    // Watcher thread aborts (SIGABRT) mid-bust_dir_cache, so `exited` resolves
    // with the signal and stderr carries the AddressSanitizer report.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0 || proc.signalCode !== null) {
      console.error(`exitCode=${exitCode}, signal=${proc.signalCode}, stderr:\n${stderr}`);
    }
    expect(stdout).toContain("READY");
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stderr).not.toContain("use-after-poison");
    expect(proc.signalCode).not.toBe("SIGABRT");
    expect(exitCode).toBe(0);
  },
  20_000,
);
// ^ explicit timeout: when the fix is absent the child reports the
// use-after-free on the File Watcher thread but the crashed thread keeps the
// stderr pipe's write end open, so the parent's `stderr` read only EOFs once
// the process is fully reaped (~7s). The assertion must win before the test
// times out, so the budget is set above that. With the fix the child exits
// cleanly in ~2s.
