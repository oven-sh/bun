import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `(*CELL.get_unchecked()).as_mut_ptr()` is banned.
//
// `ThreadCell::get_unchecked()` exists for the one situation where a thread
// other than the cell's owner touches the contents (a lock-free queue push
// plus a waker, see `bun_core::ThreadCell`). It returns a raw
// `*mut MaybeUninit<T>` so that no reference is formed. `MaybeUninit::as_mut_ptr`
// takes `&mut self`, so calling it on the deref'd result autorefs a
// `&mut MaybeUninit<T>` over the whole thread-confined struct, on a thread
// that is not its owner, while the owning thread holds its own `&T` / `&mut T`
// across its event loop. Under Stacked Borrows that retag invalidates the
// owner's reference. The pointer is never needed as a reference in the first
// place: `MaybeUninit<T>` is `repr(transparent)`, so spell it
// `CELL.get_unchecked().cast::<T>()` and project the cross-thread fields with
// `addr_of!`, as `IoRequestLoop::schedule` (src/io/lib.rs) does.
//
// The textual shape is the enforcement boundary: binding the pointer to a
// local first and calling `as_mut_ptr()` on that is not matched.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD; same guard (and reason) as
// fn-long-mut-reborrow.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// `\s*` between the tokens so a rustfmt-wrapped `.as_mut_ptr()` on the next
// line still matches.
const BANNED = /get_unchecked\(\)\s*\)\s*\.\s*as_mut_ptr\(\)/g;

// Ratcheted exceptions: files allowed to keep exactly N of the shape, with the
// reason. Lower the number when a site is converted; never raise it.
const ALLOW: Record<string, number> = {
  // `schedule()` and `shutdown_for_exit()`. Swapping the cast there is not
  // enough on its own: the HTTP thread holds a `&'static mut HttpThread`
  // across `process_events`, so the cross-thread fields need to move out of
  // the thread-confined struct first.
  "src/http/HTTPThread.rs": 2,
};

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
  // Strip full-line comments so prose mentions of the shape don't count.
  // `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
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
  // Without this the ban below would pass vacuously if the filters above ever
  // excluded everything.
  expect(scanned).toBeGreaterThan(0);
});

test("`(*cell.get_unchecked()).as_mut_ptr()` forms a `&mut` over a thread-confined struct from another thread", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
