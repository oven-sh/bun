import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `fn wakeup(&mut self)` is banned on every loop wrapper.
//
// A wakeup is the one thing other threads (and signal handlers) do to an
// event loop, and they do it while the loop's own thread is parked inside
// `tick`/`run` holding a `&mut` to that loop across the blocking call. A
// `&mut self` receiver therefore cannot be called correctly from where wakeups
// come from: every caller has to autoref a second `&mut` over the same struct
// while the first one is live, which is aliasing UB under Stacked/Tree Borrows
// (and on POSIX `us_wakeup_loop` really does write to the struct, bumping
// `pending_wakeups`). Before this lint, `uws::Loop::wakeup(&mut self)` was
// reached that way from `VmHandle` posts, the signal handler, the debugger
// thread, `PackageManager::wake_raw` and the h3 DNS callback.
//
// Shapes that are fine:
//   - `fn wakeup(&self)` when the body only reads atomics / set-once pointers
//     (`jsc::EventLoop::wakeup`, `MiniEventLoop::wakeup`, `HttpThread::wakeup`).
//   - `unsafe fn wakeup(this: *mut Self)` for the `#[repr(C)]` mirror of the C
//     loop itself (`bun_uws_sys::PosixLoop::wakeup` / `WindowsLoop::wakeup`),
//     since the C side is what gets woken and no Rust reference is needed.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// `fn wakeup(&mut self` / `fn wakeup(&'a mut self`, with any visibility and
// qualifiers in front of `fn`. Matched across newlines so a rustfmt-wrapped
// signature can't evade it. Does not match the `&self` and `this: *mut Self`
// shapes above, nor the `extern "C" fn wakeup(loop_: *mut Loop)` trampolines.
const BANNED = /\bfn\s+wakeup\s*\(\s*&\s*(?:'\w+\s+)?mut\s+self\b/g;

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions don't count. `[ \t]*`, not
  // `\s*`: `\s` crosses newlines and would shift the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("`fn wakeup(&mut self)` is banned: wakeups are called from other threads while the loop's thread holds &mut", () => {
  expect(offenders).toEqual([]);
});
