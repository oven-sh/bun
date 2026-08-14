import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `fn wakeup(&mut self)` / `fn wake(&mut self)` are banned on every loop and
// waker wrapper.
//
// Waking is the one thing other threads (and signal handlers) do to an event
// loop, and they do it while the loop's own thread is parked inside
// `tick`/`run`/`wait` holding a `&mut` (or `&`) to that loop across the
// blocking call. A `&mut self` receiver therefore cannot be called correctly
// from where wakeups come from: every caller has to autoref a second `&mut`
// over the same struct while the first borrow is live, which is aliasing UB
// under Stacked/Tree Borrows (and on POSIX `us_wakeup_loop` really does write
// to the struct, bumping `pending_wakeups`). Before this lint,
// `uws::Loop::wakeup(&mut self)` was reached that way from `VmHandle` posts,
// the signal handler, the debugger thread, `PackageManager::wake_raw` and the
// h3 DNS callback, and the macOS `bun_io` waker's `wake(&mut self)` from the
// bundler and IO threads.
//
// Shapes that are fine:
//   - `fn wakeup(&self)` / `fn wake(&self)` whose body only loads the pointer
//     or fd it needs and hands it to the raw wake (`uws::Loop::wakeup`, a write
//     to the eventfd, ...), forming no reference to the loop being woken:
//     `HttpThread::wakeup` (pointer published through an atomic),
//     `MiniEventLoop::wakeup` (set-once field), the `bun_io::waker` types (fds),
//     `jsc::EventLoop::wakeup` (reads `event_loop_handle`; making that load
//     atomic is a separate change, the receiver shape is already right).
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

// `fn wake(&mut self` / `fn wakeup(&'a mut self`, with any visibility and
// qualifiers in front of `fn` and optional generics after the name. Matched
// across newlines so a rustfmt-wrapped signature can't evade it. Does not match
// the `&self` and `this: *mut Self` shapes above, nor the
// `extern "C" fn wakeup(loop_: *mut Loop)` trampolines.
//
// The name list is the enforcement boundary: `wake` and `wakeup` are the two
// spellings the tree uses for this operation. A cross-thread wake entry point
// under another name has to be added here to be covered.
const BANNED = /\bfn\s+(?:wake|wakeup)\s*(?:<[^>]*>)?\s*\(\s*&\s*(?:'\w+\s+)?mut\s+self\b/g;

/** `line: matched text` for every banned definition in one file's source. */
function findBanned(content: string): string[] {
  // Strip full-line comments so prose mentions don't count. `[ \t]*`, not
  // `\s*`: `\s` crosses newlines and would shift the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const hits: string[] = [];
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    hits.push(`${line}: ${m[0].replace(/\s+/g, " ")}`);
  }
  return hits;
}

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  for (const hit of findBanned(await file(abs).text())) {
    offenders.push(`${source}:${hit}`);
  }
}

test("the matcher recognizes the banned receiver shapes and nothing else", () => {
  // The tree is expected to contain zero matches, so the ban below would also
  // pass if the pattern silently stopped matching; pin it on literal snippets.
  expect(findBanned("impl PosixLoop {\n    pub fn wakeup(&mut self) {}\n}\n")).toEqual(["2: fn wakeup(&mut self"]);
  expect(findBanned("impl KEventWaker {\n    pub fn wake(&mut self) {}\n}\n")).toEqual(["2: fn wake(&mut self"]);
  expect(findBanned("pub(crate) fn wakeup(&'a mut self, n: u32) {}")).toEqual(["1: fn wakeup(&'a mut self"]);
  expect(findBanned("fn wake<W: Waker>(&mut self) {}")).toEqual(["1: fn wake<W: Waker>(&mut self"]);
  expect(findBanned("pub unsafe fn wakeup(\n    &mut self,\n    reason: Reason,\n) {}")).toEqual([
    "1: fn wakeup( &mut self",
  ]);
  expect(findBanned("// was `fn wakeup(&mut self)` before\npub fn wakeup(&self) {}")).toEqual([]);
  expect(findBanned("pub fn wake(&self) {}")).toEqual([]);
  expect(findBanned("pub unsafe fn wakeup(this: *mut Self) {}")).toEqual([]);
  expect(findBanned('extern "C" fn wakeup(_loop: *mut uws::Loop) {}')).toEqual([]);
  expect(findBanned("fn wakeup_all(&mut self) {}")).toEqual([]);
  expect(findBanned("pub(crate) fn wake_own_loop(&mut self) {}")).toEqual([]);
});

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("`fn wake(&mut self)` / `fn wakeup(&mut self)` are banned: wakes come from other threads while the loop's thread holds a borrow", () => {
  expect(offenders).toEqual([]);
});
