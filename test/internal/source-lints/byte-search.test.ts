import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Byte / substring search over `&[u8]` must go through `bun_core::strings`
// (highway, runtime-dispatched SIMD), not libcore's element-generic slice and
// iterator methods, which compile to one-byte-at-a-time scalar loops (or, for
// `<[u8]>::contains`, a usize-at-a-time SWAR loop with no vector registers).
//
// The methods whose *every* use is a text search (`str::find`, `str::contains`,
// `slice::windows`, `memchr::*`, `bstr::ByteSlice::find*`, ...) are banned
// type-precisely via `disallowed-methods` in clippy.toml. What's left for this
// file are the element-generic forms clippy can't distinguish by element type —
// `<[T]>::contains` and `Iterator::{position,rposition,any,all,find}` — matched
// here only when the comparand is a byte literal, so `ids.contains(&id)` on a
// `&[u32]` never trips it.
//
//   .contains(&b'x') / .contains(&0)          → strings::contains_char(s, b'x')
//   .iter().position(|&b| b == b'x')          → strings::index_of_char_usize(s, b'x')
//   .iter().position(|&b| b == x || b == y)   → strings::index_of_any(s, b"xy")
//   .iter().rposition(|&b| b == b'x')         → strings::last_index_of_char(s, b'x')
//   .iter().any(|&b| b == b'x')               → strings::contains_char(s, b'x')
//   .iter().all(|&b| b != b'x')               → !strings::contains_char(s, b'x')
//   .iter().filter(|&&b| b == b'x').count()   → strings::count_char(s, b'x')
//   .split(|&b| b == b'x')                    → strings::split(s, b"x")
//
// A comparand held in a variable (`|&b| b == sep`) is invisible to this lint;
// use the `strings::` form anyway.

const root = path.resolve(import.meta.dir, "..", "..", "..");
// Proc-macro crates and cargo build scripts run on the host at compile time and
// cannot link the highway C++ objects, so libcore is all they have. Both are
// read off each crate's Cargo.toml rather than guessed from its name.
const hostOnly: string[] = [];
for (const manifest of new Bun.Glob("src/*/Cargo.toml").scanSync({ cwd: root })) {
  const dir = path.dirname(manifest).replaceAll(path.sep, "/");
  const toml = await file(path.join(root, manifest)).text();
  if (/^\s*proc-macro\s*=\s*true\b/m.test(toml)) hostOnly.push(dir + "/");
  const build = /^\s*build\s*=\s*"([^"]+)"/m.exec(toml);
  hostOnly.push(path.posix.join(dir, build ? build[1] : "build.rs"));
}
const rustSources = globAllSources().rust.filter(abs => {
  if (!abs.endsWith(".rs")) return false;
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  return !hostOnly.some(h => (h.endsWith("/") ? rel.startsWith(h) : rel === h));
});

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// A byte literal (`b'x'`, `b'\n'`, `b'\x1b'`, `b'\''`) or a bare `0` (NUL scans).
const BYTE = String.raw`(?:b'(?:[^'\\]|\\.|\\x[0-9a-fA-F]{2})'|0)`;
// Closure header binding one name, by value or by `&`/`&&` pattern: |b|, |&b|, |&&b|, |b: &u8|.
const PARAM = String.raw`\|\s*&{0,2}\s*(\w+)\s*(?::\s*&?\s*u8\s*)?\|`;
// The bound name, optionally dereferenced.
const USE = String.raw`\*{0,2}\s*\1`;
// `b == b'x'`, `b'x' == b`, or `matches!(b, b'x' | b'y')`, optionally chained with `||`.
// (A `matches!` with range patterns like `b'0'..=b'9'` has no set-membership
// equivalent and is deliberately not matched.)
const CMP1 = String.raw`(?:${USE}\s*==\s*${BYTE}|${BYTE}\s*==\s*${USE}|matches!\(\s*${USE}\s*,\s*${BYTE}(?:\s*\|\s*${BYTE})*\s*\))`;
const BODY_EQ = String.raw`\s*(?:${CMP1})(?:\s*\|\|\s*${CMP1})*\s*\)`;
const BODY_NE = String.raw`\s*${USE}\s*!=\s*${BYTE}\s*\)`;

const BANNED: { name: string; re: RegExp; hint: string }[] = [
  {
    name: "<[u8]>::contains(&byte)",
    re: new RegExp(String.raw`\.contains\(\s*&\s*${BYTE}\s*\)`, "g"),
    hint: "strings::contains_char(s, b)",
  },
  {
    name: "iter().position(|b| b == byte)",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.position\(\s*${PARAM}${BODY_EQ}`, "g"),
    hint: 'strings::index_of_char_usize(s, b) / strings::index_of_any(s, b"..")',
  },
  {
    name: "iter().rposition(|b| b == byte)",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.rposition\(\s*${PARAM}${BODY_EQ}`, "g"),
    hint: "strings::last_index_of_char(s, b)",
  },
  {
    name: "iter().any(|b| b == byte)",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.any\(\s*${PARAM}${BODY_EQ}`, "g"),
    hint: 'strings::contains_char(s, b) / strings::index_of_any(s, b"..").is_some()',
  },
  {
    name: "iter().all(|b| b != byte)",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.all\(\s*${PARAM}${BODY_NE}`, "g"),
    hint: "!strings::contains_char(s, b)",
  },
  {
    name: "iter().find(|b| b == byte)",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.find\(\s*${PARAM}${BODY_EQ}`, "g"),
    hint: "strings::index_of_char_usize(s, b)",
  },
  {
    name: "iter().filter(|b| b == byte).count()",
    re: new RegExp(String.raw`\.(?:iter|bytes)\(\)\s*\.filter\(\s*${PARAM}${BODY_EQ}\s*\.count\(\)`, "g"),
    hint: "strings::count_char(s, b)",
  },
  {
    name: "<[u8]>::split(|b| b == byte)",
    re: new RegExp(String.raw`\.split\(\s*${PARAM}${BODY_EQ}`, "g"),
    hint: 'strings::split(s, b"x") / strings::split_any(s, b"xy")',
  },
];

// Documented, ratcheted exceptions: `file: count`. Prefer converting over
// adding an entry here.
const ALLOW: Record<string, number> = {
  // `#[cfg(test)]` unit test built only by `cargo test -p bun_collections`,
  // which does not link the highway objects.
  "src/collections/linear_fifo.rs": 1,
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
  // Blank out full-line comments (keeping the newline) so prose mentions don't
  // count and reported line numbers stay accurate.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const { name, re, hint } of BANNED) {
    for (const m of stripped.matchAll(re)) {
      const line = stripped.slice(0, m.index).split("\n").length;
      counts[source] = (counts[source] ?? 0) + 1;
      if ((counts[source] ?? 0) > (ALLOW[source] ?? 0)) {
        offenders.push(`${source}:${line}: ${name}: \`${m[0].replace(/\s+/g, " ")}\` → ${hint}`);
      }
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("byte search goes through bun_core::strings (highway), not libcore scalar loops", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
