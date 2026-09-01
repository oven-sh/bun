import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `MaybeUninit::uninit().assume_init()` on an integer array produces a value
// whose bytes are uninitialized. The Rust reference lists that as undefined
// behavior no matter what the code does with the bytes afterwards, and Miri
// stops at the constructor:
//
//   constructing invalid value of type [u8; 2048]: at [0], encountered
//   uninitialized memory, but expected an integer
//
// rustc's `invalid_value` lint (an error under the workspace `warnings = deny`)
// and clippy's `uninit_assumed_init` both catch the pattern, so such code only
// compiles under an `#[allow(..)]` for them. A scratch buffer is
// `[MaybeUninit<T>; N]` instead, written with `write_copy_of_slice` / `write`
// and read back through `assume_init_ref` on the written prefix. See
// `bun_url::URL::join_normalize` and `bun_paths::resolve_path::join_string_buf_t`.
//
// `PathBuffer::uninit` and `WPathBuffer::uninit` in `src/bun_core/util.rs`
// still use the pattern. Their ~400 call sites need an initialized-prefix API
// (or the path buffer pool) before they can change. This lint keeps that set
// from growing; remove the entry when those two are fixed.
const KNOWN_SITES = ["src/bun_core/util.rs"];

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

const sources = new Map<string, string>();
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions don't count.
  sources.set(source, content.replace(/^\s*\/\/.*$/gm, ""));
}

function scan(pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const [source, stripped] of sources) {
    if (pattern.test(stripped)) {
      offenders.push(source);
    }
  }
  return offenders.sort();
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertion below pass vacuously.
  expect(sources.size).toBeGreaterThan(0);
});

test("no new #[allow(invalid_value)] or #[allow(clippy::uninit_assumed_init)]", () => {
  // `[^)]*` spans the multi-line form of the attribute; lint paths never
  // contain `)`.
  expect(scan(/#!?\[(?:allow|expect)\([^)]*\b(?:invalid_value|clippy::uninit_assumed_init)\b/)).toEqual(KNOWN_SITES);
});
