import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `let this = unsafe { &mut *this };` — the fn-long exclusive reborrow of a
// callback's raw pointer — is banned, under any binding name.
//
// The shape asserts exclusive access to the object for the rest of the
// function, but the functions that receive these pointers are callbacks
// (uSockets/libuv handlers, task-queue arms, vtable dispatch) whose bodies run
// JS or dispatch events that can re-enter the same object through its own
// accessors. Under Stacked/Tree Borrows the re-entrant access pops the
// fn-long tag, making every later use of the binding UB; before that it's an
// LLVM `noalias` miscompile hazard.
//
// Replacements, in preference order (see the sweep that removed the last ~370
// of these for worked examples):
//   - `let x = unsafe { &*ptr };` when everything reached is `&self` /
//     `Cell`/`JsCell` (TRAMPOLINE).
//   - Statement-scoped raw place access `unsafe { (*ptr).field = v };`, a
//     call-scoped `unsafe { &mut *ptr }` argument, `heap::take(ptr)` Box
//     reclaim, or a `&mut self` prep method invoked as
//     `unsafe { (*ptr).prep() }` (DEAD).
//   - Convert the type's touched state to `Cell`/`JsCell` and its methods to
//     `&self` (REENTRANT) — exemplars: `src/runtime/ipc.rs` (SendQueue),
//     `src/runtime/socket/UpgradedDuplex.rs`, `src/io/PipeReader.rs`'s raw
//     `read`/`on_poll` entry chain.
//
// Sibling guards: frozen-nonnull-reborrow.test.ts, unsound-erased-box.test.ts.

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

// A `let` binding (any name, optionally typed) of `unsafe { &mut *<param> }`
// where <param> is one of the raw-pointer callback-parameter names used across
// the tree. Matched across newlines so a rustfmt-wrapped binding can't evade
// it. `[^=;{}]*` after the binding name permits a type ascription but cannot
// cross into a different statement; the trailing `;` requires the unsafe
// block to be the entire initializer, so a call-scoped
// `unsafe { &mut *p }.method()` expression does not count.
//
// The name list is the enforcement boundary: reborrows of locals or fields
// (`&mut *self.log()`, `&mut *existing_ptr`) are a separate, pre-existing
// population outside this lint's scope. If you add a new raw callback-param
// name, add it here.
const BANNED =
  /let\s+(?:mut\s+)?\w+\s*(?::[^=;{}]*)?=\s*unsafe\s*\{\s*&mut\s+\*(?:this|ctx|p|ptr|self_ptr|this_ptr|raw|task|handle|data|context|user_data|parent|client|ws|req|resp|socket)\b\s*\}\s*;/g;

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape, with a stated reason. Empty by design — the whole tree is at zero.
// Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {};

const counts: Record<string, number> = {};
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
  // Strip full-line comments so prose mentions (including this file) don't
  // count. `[ \t]*`, not `\s*`: `\s` crosses newlines, so a comment preceded
  // by blank lines would swallow them and shift every reported line number.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    counts[source] = (counts[source] ?? 0) + 1;
    if ((counts[source] ?? 0) > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("fn-long `&mut *<callback param>` reborrow is banned", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: if an allowlisted file drops below its budget (the shape was
  // finally converted), lower the ALLOW entry so no new one can slip back in.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
