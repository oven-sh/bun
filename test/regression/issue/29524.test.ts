// Regression for https://github.com/oven-sh/bun/issues/29524
//
// On macOS, `flushEvictions` in src/Watcher.zig compacts the watchlist with
// `MultiArrayList.swapRemove`, but the kqueue registration for the entry that
// moved into the vacated slot still carries its old `udata` (its pre-swap
// watchlist index). Subsequent kevents for that fd were then routed to the
// wrong module, so an atomic write (write-tmp + rename-over, the way vim,
// VSCode, prettier, claude-code, etc. save files) to a second imported file
// after the first eviction stopped propagating — the module graph oscillated
// between old and new state instead of converging.
//
// This test spawns `bun --hot` on an entry that imports three modules, prints
// a "[tick] a() b() c()" line periodically, and performs three atomic writes
// in the a -> c -> b order that triggers the bug. Each write must be reflected
// in a subsequent tick. Before the fix the b-1 tick never arrived on macOS;
// after the fix all three atomic writes propagate.
//
// Linux uses inotify and re-resolves the watchlist index on every event
// (`INotifyWatcher.zig` — `indexOfScalar(eventlist_index, ...)`), so the bug
// is macOS-specific. Windows uses a different watcher entirely. Skipping
// off macOS keeps this focused on the platform where the bug lives.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.skipIf(!isMacOS)("atomic writes to multiple imported files keep propagating under --hot (#29524)", async () => {
  using dir = tempDir("issue-29524", {
    "a.js": `export function a() { return "a-0"; }\n`,
    "b.js": `export function b() { return "b-0"; }\n`,
    "c.js": `export function c() { return "c-0"; }\n`,
    "entry.js":
      `import { a } from "./a.js";\n` +
      `import { b } from "./b.js";\n` +
      `import { c } from "./c.js";\n` +
      // 50ms is fast enough to observe oscillation between writes but slow
      // enough not to flood stdout.
      `setInterval(() => { process.stdout.write("[tick] " + a() + " " + b() + " " + c() + "\\n"); }, 50);\n`,
  });
  const cwd = String(dir);
  const aFile = join(cwd, "a.js");
  const bFile = join(cwd, "b.js");
  const cFile = join(cwd, "c.js");

  await using runner = Bun.spawn({
    cmd: [bunExe(), "--hot", "run", join(cwd, "entry.js")],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  // Atomic replace via temp-file + rename, identical to the idiom that
  // triggers the bug in real editors/tools.
  function atomicWrite(path: string, content: string) {
    const tmp = path + ".atomic";
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  }

  let buffered = "";
  const decoder = new TextDecoder();
  const reader = runner.stdout.getReader();

  async function waitForTick(ticker: string) {
    // 10s budget per step is plenty for a 50ms-tick entry; on the fixed
    // build each transition lands within a few hundred ms.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (buffered.includes(ticker)) return true;
      const res = await reader.read();
      if (res.done) return buffered.includes(ticker);
      buffered += decoder.decode(res.value);
    }
    return buffered.includes(ticker);
  }

  try {
    // Baseline reload confirms the watcher is wired up.
    expect(await waitForTick("[tick] a-0 b-0 c-0")).toBe(true);

    // Write #1 — rewrite a.js. Before the fix this step still works (the
    // first eviction happens here, but nothing has yet been misrouted).
    atomicWrite(aFile, `export function a() { return "a-1"; }\n`);
    expect(await waitForTick("[tick] a-1 b-0 c-0")).toBe(true);

    // Write #2 — rewrite c.js. Works coincidentally on buggy builds because
    // c still happens to be findable at the stale index.
    atomicWrite(cFile, `export function c() { return "c-1"; }\n`);
    expect(await waitForTick("[tick] a-1 b-0 c-1")).toBe(true);

    // Write #3 — rewrite b.js. On buggy macOS builds the b-1 tick NEVER
    // appears: the module graph instead oscillates between
    // `[tick] a-1 b-0 c-1` and `[tick] a-0 b-0 c-0`. With the kqueue
    // udata re-registration fix in flushEvictions, all three writes land.
    atomicWrite(bFile, `export function b() { return "b-1"; }\n`);
    expect(await waitForTick("[tick] a-1 b-1 c-1")).toBe(true);
  } finally {
    reader.cancel().catch(() => {});
  }
});
