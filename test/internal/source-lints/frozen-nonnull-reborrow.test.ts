import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `NonNull::from(&*expr)` is always a bug waiting to happen.
//
// The `&*` takes something that derefs to `&mut T` (a `Box`, a `&mut T`, an
// arena's `alloc()` return) and downgrades it to `&T`, so `NonNull::from` picks
// the `From<&T>` impl. Under Tree Borrows the resulting tag is *frozen*: it may
// be read through, never written through. Code that stores such a pointer and
// later writes through it — or keeps it while something writes through the
// original `&mut` — is UB.
//
// Three of these existed, all storing the pointer past the borrow that produced
// it:
//
//   - `Parser::new`'s arena arm froze the `JsonTape` root, so every later
//     `tape_mut()` write through it was UB (bundler JSON imports).
//   - `RouteLoader::append_route` froze the `/index.js` route pointer *and*
//     derived it before moving the `Box` into `all_routes`.
//   - `start_queued_task` froze the in-flight HTTP pointer, then immediately
//     wrote through the `&mut` it came from.
//
// If you need a raw pointer that outlives the borrow, take it from the
// allocation itself: `NonNull::from(&mut *x)`, `heap::into_raw(boxed)`, or a
// `fn root_ptr(&mut self) -> NonNull<Self>` helper. Derive it *after* any move
// of the owning `Box` — moving a `Box` retags it, and a pointer taken before
// the move is a stale sibling of the one the new owner holds.
//
// Sibling guard: test/internal/source-lints/unsound-erased-box.test.ts.

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

// `NonNull::from(&*` — optionally qualified (`core::ptr::NonNull`, `ptr::NonNull`).
// `&\s*\*` so rustfmt-introduced whitespace still matches. Does not match
// `NonNull::from(&mut *x)`, which is the correct spelling.
const FROZEN_REBORROW = /NonNull::from\(\s*&\s*\*/g;

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
  // Strip full-line comments so prose mentions (including this file's siblings)
  // don't count.
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  for (const line of stripped.split("\n")) {
    FROZEN_REBORROW.lastIndex = 0;
    if (FROZEN_REBORROW.test(line)) offenders.push(`${source}: ${line.trim()}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing (e.g. a
  // symlinked checkout root) and leaving nothing to scan, which would make the
  // ban below pass vacuously. Same guard as unsound-erased-box.test.ts.
  expect(scanned).toBeGreaterThan(0);
});

test("NonNull::from(&*x) — frozen reborrow stored past its borrow", () => {
  expect(offenders).toEqual([]);
});
