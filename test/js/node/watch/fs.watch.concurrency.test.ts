import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for PathWatcherManager deadlock and UAF bugs:
// - Self-deadlock in unregisterWatcher (deinit() called while holding mutex)
// - UAF in deferred deinit (destroy while mutex held)
// - AB/BA deadlock between watcher.mutex and manager.mutex
// - Race in pending_tasks/deinit_on_last_task
// - Race in PathWatcher.deinit (setClosed + hasPendingDirectories not atomic)
//
// Strategy: Create recursive watchers (which spawn directory-scanning thread
// pool tasks), then close them while those tasks are in-flight. Mixed timing
// of creation, file mutation, and closure maximizes race window coverage.
// The test spawns child processes; if one deadlocks or crashes, the test fails.

test("concurrent recursive fs.watch create/destroy does not deadlock or crash", async () => {
  const RUNS = 10;
  for (let run = 0; run < RUNS; run++) {
    const script = `
const fs = require("fs");
const path = require("path");
const os = require("os");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "bun-watch-stress-"));

// Create directory trees with enough depth for directory scanning work
for (let i = 0; i < 4; i++) {
  const sub = path.join(base, "sub" + i, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, "f.txt"), "x");
  fs.writeFileSync(path.join(base, "sub" + i, "f.txt"), "x");
  fs.writeFileSync(path.join(base, "sub" + i, "a", "f.txt"), "x");
}

let cycle = 0;
const CYCLES = 60;

function tick() {
  const watchers = [];
  const idx = cycle % 4;

  // Create recursive watchers on different directories each cycle
  try { watchers.push(fs.watch(path.join(base, "sub" + idx), { recursive: true }, () => {})); } catch(e) {}
  try { watchers.push(fs.watch(path.join(base, "sub" + ((idx+1)%4)), { recursive: true }, () => {})); } catch(e) {}
  // Non-recursive watcher sharing same PathWatcherManager
  try { watchers.push(fs.watch(base, { recursive: false }, () => {})); } catch(e) {}

  // Mutate file while scanning tasks are in-flight
  try { fs.writeFileSync(path.join(base, "sub" + idx, "a", "b", "f.txt"), "" + cycle); } catch(e) {}

  // Close with mixed timing to maximize contention
  for (let i = 0; i < watchers.length; i++) {
    const w = watchers[i];
    if (i % 3 === 0) { try { w.close(); } catch(e) {} }
    else if (i % 3 === 1) { Promise.resolve().then(() => { try { w.close(); } catch(e) {} }); }
    else { setTimeout(() => { try { w.close(); } catch(e) {} }, 0); }
  }

  cycle++;
  if (cycle < CYCLES) {
    if (cycle % 2 === 0) queueMicrotask(tick);
    else setTimeout(tick, 0);
  } else {
    setTimeout(() => {
      try { fs.rmSync(base, { recursive: true, force: true }); } catch(e) {}
      process.exit(0);
    }, 200);
  }
}
tick();
`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = 30_000;
    const result = await Promise.race([
      proc.exited.then(code => ({ kind: "exit" as const, code })),
      new Promise<{ kind: "timeout" }>(resolve => setTimeout(() => resolve({ kind: "timeout" }), timeout)),
    ]);

    if (result.kind === "timeout") {
      proc.kill();
      await proc.exited;
      expect().fail(`Process deadlocked on run ${run + 1}/${RUNS} (did not exit within ${timeout}ms).`);
    }

    // Exit code 0 is the proof: deadlocks cause timeout (caught above),
    // and crashes produce non-zero exit codes.
    expect(result).toEqual({ kind: "exit", code: 0 });
  }
}, 360_000);
