import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Posting to a non-JS event loop from another thread is a shared-access
// operation, and the code has to say so in both places it can be got wrong.
//
// `MiniEventLoop` (bundler, shell, install, `bun run` script threads) and the
// `AnyEventLoop` wrapper around it are owned by the thread that ticks them.
// Other threads reach them through exactly three entry points: the two
// `enqueue_task_concurrent*` fns (an MPSC push plus a wakeup) and `wakeup`
// itself (a thread-safe `us_wakeup_loop` on a raw pointer). Those bodies need
// `&self`. Declaring them on `&mut self` does not make the push any safer; it
// forces every cross-thread poster to mint a `&mut` to a loop whose owner is
// inside `tick*` holding its own `&mut` at that moment. That is the aliasing
// the JS loop already avoids (`VmHandle::post` forms `&EventLoop` and uses
// `concurrent_tasks.push(&self)` + `wakeup(&self)`), and it was how this tree
// looked until the receivers were flipped:
//
//   - `ConcurrentPoster::post_mini` (work-pool completions for fs.cp, shell
//     builtins, password hashing, zlib) and the process waiter thread posted
//     through `unsafe { backref.get_mut() }.enqueue_task_concurrent(..)`;
//   - `LinkerContext::any_loop_mut` handed `&mut AnyEventLoop` to every parse
//     worker and to the plugin host's JS thread, concurrently with each other
//     and with the bundle thread ticking the loop;
//   - `PackageManager::wake_raw` formed `&mut AnyEventLoop` on each install
//     task thread because `AnyEventLoop::wakeup` took `&mut self`.
//
// Two checks, because fixing one side does not keep the other fixed:
//
//   1. the entry points in src/event_loop/ take `&self` (a `&mut self` here
//      would force every poster back onto the `&mut` path);
//   2. no call site reaches an entry point through `get_mut()` /
//      `assume_mut()` (against a `&self` receiver that still compiles, and
//      silently reintroduces the cross-thread `&mut`). The right spelling is
//      the safe `BackRef` / `ParentRef` deref.
//
// Sibling guards: fn-long-mut-reborrow.test.ts (the same aliasing, formed on
// the owning thread by re-entrant callbacks), frozen-nonnull-reborrow.test.ts.

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

// The cross-thread entry points of the loops defined under src/event_loop/.
// `SpawnSyncEventLoop`'s `extern "C" fn wakeup(_loop)` has no receiver and is
// not matched. Group 1 is the fn name, group 2 the receiver.
const ENTRY_POINT_DIR = "src/event_loop/";
const ENTRY_POINT =
  /\bfn\s+(enqueue_task_concurrent_with_extra_ctx|enqueue_task_concurrent|wakeup)\b(?:<[^>]*>)?\s*\(\s*(&\s*mut\s+self|&\s*self)\b/g;

// `x.get_mut().enqueue_task_concurrent(..)`, `unsafe { x.get_mut() }.wakeup()`,
// `x.assume_mut().enqueue_task_concurrent_with_extra_ctx(..)`, optionally split
// across lines by rustfmt.
const POST_THROUGH_MUT =
  /\b(?:get_mut|assume_mut)\(\)\s*\}?\s*\.\s*(?:enqueue_task_concurrent\w*|wakeup)\s*(?:::<[^>]*>\s*)?\(/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

const entryPoints: string[] = [];
const mutReceivers: string[] = [];
const postsThroughMut: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments (including `///` docs) so prose mentions don't
  // count. `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");

  if (source.startsWith(ENTRY_POINT_DIR)) {
    for (const m of stripped.matchAll(ENTRY_POINT)) {
      const entry = `${source}:${lineOf(stripped, m.index)}: fn ${m[1]}(${m[2].replace(/\s+/g, " ")})`;
      entryPoints.push(entry);
      if (m[2].includes("mut")) mutReceivers.push(entry);
    }
  }

  for (const m of stripped.matchAll(POST_THROUGH_MUT)) {
    postsThroughMut.push(`${source}:${lineOf(stripped, m.index)}: ${m[0].replace(/\s+/g, " ")}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern still recognizes the event loops' cross-thread entry points", () => {
  // If this shrinks, the entry points were renamed or moved and the regex /
  // directory above need updating, not the assertions below.
  const names = new Set(entryPoints.map(e => e.slice(e.indexOf(": fn ") + 5, e.indexOf("("))));
  expect([...names].sort()).toEqual(["enqueue_task_concurrent", "enqueue_task_concurrent_with_extra_ctx", "wakeup"]);
});

test("event loop enqueue_task_concurrent*/wakeup take &self", () => {
  expect(mutReceivers).toEqual([]);
});

test("no call site posts to or wakes an event loop through get_mut()/assume_mut()", () => {
  expect(postsThroughMut).toEqual([]);
});
