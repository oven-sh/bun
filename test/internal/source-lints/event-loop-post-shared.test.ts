import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Posting to a `MiniEventLoop` from another thread is a shared-access
// operation, and the code has to say so in both places it can be got wrong.
//
// A `MiniEventLoop` (bundler, shell, install, `bun run` script threads) is
// owned by the thread that ticks it. Other threads (work-pool completions via
// `ConcurrentPoster::post_mini`, the process waiter thread, the bundler's parse
// workers and plugin host thread) post to it through the two
// `enqueue_task_concurrent*` fns, whose bodies are an MPSC push plus a wakeup
// and so need only `&self`, which is also how the JS loop is posted to
// (`VmHandle::post` forms `&EventLoop`). Declaring them on `&mut self` does not
// make the push any safer; it forces every poster to mint a `&mut` to a loop
// whose owner is inside `tick*` holding its own `&mut` at that moment, which is
// what the posters did until the receivers were flipped, either directly
// (`unsafe { backref.get_mut() }.enqueue_task_concurrent(..)`) or through an
// accessor (below).
//
// Two checks, because fixing one side does not keep the other fixed:
//
//   1. the entry points take `&self` (a `&mut self` here would force every
//      poster back onto the `&mut` path);
//   2. no call site reaches an entry point through `get_mut()` /
//      `assume_mut()` (against a `&self` receiver that still compiles, and
//      silently reintroduces the cross-thread `&mut`). The right spelling is
//      the safe `BackRef` / `ParentRef` deref.
//
// Not covered: a poster that gets its `&mut` from an accessor instead, which is
// how the bundler's sites used to look (`LinkerContext::any_loop_mut` returning
// `&mut AnyEventLoop`); those are held to `&` only by `LinkerContext::any_loop`'s
// return type. Waking a loop (the `wakeup` receivers, one layer down) is the
// other half of this and is out of scope here. Sibling guards:
// fn-long-mut-reborrow.test.ts (the same aliasing, formed on the owning thread
// by re-entrant callbacks), frozen-nonnull-reborrow.test.ts.

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

// `MiniEventLoop`'s posting entry points (the only `enqueue_task_concurrent*`
// definitions under src/event_loop/). Group 1 is the fn name, group 2 the receiver.
const ENTRY_POINT_DIR = "src/event_loop/";
const ENTRY_POINT =
  /\bfn\s+(enqueue_task_concurrent_with_extra_ctx|enqueue_task_concurrent)\b(?:<[^>]*>)?\s*\(\s*(&\s*mut\s+self|&\s*self)\b/g;

// `x.get_mut().enqueue_task_concurrent(..)`, `unsafe { x.get_mut() }.enqueue_task_concurrent(..)`,
// `x.assume_mut().enqueue_task_concurrent_with_extra_ctx::<A, B>(..)`, optionally
// split across lines by rustfmt.
const POST_THROUGH_MUT = /\b(?:get_mut|assume_mut)\(\)\s*\}?\s*\.\s*enqueue_task_concurrent\w*\s*(?:::<[^>]*>\s*)?\(/g;

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

test("the pattern still recognizes MiniEventLoop's posting entry points", () => {
  // If this shrinks, the entry points were renamed or moved and the regex /
  // directory above need updating, not the assertions below.
  const names = new Set(entryPoints.map(e => e.slice(e.indexOf(": fn ") + 5, e.indexOf("("))));
  expect([...names].sort()).toEqual(["enqueue_task_concurrent", "enqueue_task_concurrent_with_extra_ctx"]);
});

test("MiniEventLoop::enqueue_task_concurrent* take &self", () => {
  expect(mutReceivers).toEqual([]);
});

test("no call site posts to a MiniEventLoop through get_mut()/assume_mut()", () => {
  expect(postsThroughMut).toEqual([]);
});
