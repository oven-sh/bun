import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `bun_core::ThreadCell<T>` is `RacyCell<T>` plus a debug-only owner latch:
// once the owning thread calls `CELL.claim()`, every `CELL.get()` from another
// thread panics in debug builds. A `ThreadCell` static that is never claimed
// has no latch at all, so the thread confinement its type advertises goes
// unchecked and cross-thread callers accumulate silently. `bun_http`'s
// `HTTP_THREAD` went unclaimed long enough for the JS thread to be handed
// `&'static mut HttpThread` on every fetch abort, body write and stream resume
// while the HTTP thread held its own `&'static mut` for the life of the
// process. This lint requires a `claim()` for every `ThreadCell` static so
// the latch stays armed.
//
// Claims are looked up within the declaring crate (the directory of the
// nearest `Cargo.toml`): `bun_io` declares `LOOP` and claims it in the same
// file, `bun_http` declares `HTTP_THREAD` in lib.rs and claims it in
// HTTPThread.rs.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rust = globAllSources().rust;

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

function repoRelative(abs: string): string {
  return path.relative(root, abs).replaceAll(path.sep, "/");
}

// Crate roots, longest first, so a file inside a nested crate is attributed to
// the nested crate rather than to a parent crate's directory.
const crateDirs = rust
  .filter(p => path.basename(p) === "Cargo.toml")
  .map(p => repoRelative(path.dirname(p)))
  .sort((a, b) => b.length - a.length);

function crateOf(source: string): string {
  return crateDirs.find(dir => source.startsWith(dir + "/")) ?? path.posix.dirname(source);
}

// `static [mut] NAME: ThreadCell<` with any path prefix (`bun_core::ThreadCell`,
// `crate::atomic_cell::ThreadCell`) and any visibility; the type may start on
// the line after the colon.
const DECLARATION = /\bstatic\s+(?:mut\s+)?([A-Za-z_]\w*)\s*:\s*(?:[\w:]+::)?ThreadCell\s*</g;

// Per crate: comment-stripped source of every tracked file.
const crates = new Map<string, { source: string; stripped: string }[]>();
let scanned = 0;
for (const abs of rust) {
  if (!abs.endsWith(".rs")) continue;
  const source = repoRelative(abs);
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (repoRelative(realpathSync(abs)) !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so doc prose ("`claim()` is invoked from ...")
  // neither declares nor claims anything.
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  const crate = crateOf(source);
  let files = crates.get(crate);
  if (files === undefined) crates.set(crate, (files = []));
  files.push({ source, stripped });
}

const declared: { name: string; source: string; crate: string }[] = [];
for (const [crate, files] of crates) {
  for (const { source, stripped } of files) {
    for (const match of stripped.matchAll(DECLARATION)) {
      declared.push({ name: match[1], source, crate });
    }
  }
}

const unclaimed: string[] = [];
for (const { name, source, crate } of declared) {
  const claim = new RegExp(String.raw`\b${name}\s*\.\s*claim\s*\(`);
  const claimed = crates.get(crate)!.some(f => claim.test(f.stripped));
  if (!claimed) unclaimed.push(`${source}: static ${name} (crate ${crate}) is never claim()ed`);
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing (e.g. a
  // symlinked checkout root) and leaving nothing to scan, which would make the
  // assertions below pass vacuously. Same guard as unsound-erased-box.test.ts.
  expect(scanned).toBeGreaterThan(0);
});

test("DECLARATION still matches real ThreadCell statics", () => {
  // `bun_io`'s LOOP and `bun_http`'s HTTP_THREAD exist today; if the type or
  // the declaration shape changes, the regex needs updating rather than the
  // claim check below passing with nothing to check.
  expect(declared.length).toBeGreaterThan(0);
});

test("every ThreadCell static is claim()ed somewhere in its crate", () => {
  expect(unclaimed).toEqual([]);
});
