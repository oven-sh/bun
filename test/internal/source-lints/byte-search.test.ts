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
// `<[T]>::contains`, the `<[T]>::split*` / `rsplit*` methods and
// `Iterator::{position,rposition,any,all,find}` — matched here only when the
// comparand is a byte literal, so `ids.contains(&id)` on a `&[u32]` never trips
// it.
//
//   .contains(&b'x') / .contains(&0)          → strings::contains_char(s, b'x')
//   .iter().position(|&b| b == b'x')          → strings::index_of_char_usize(s, b'x')
//   .iter().position(|&b| b == x || b == y)   → strings::index_of_any(s, b"xy")
//   .iter().rposition(|&b| b == b'x')         → strings::last_index_of_char(s, b'x')
//   .iter().any(|&b| b == b'x')               → strings::contains_char(s, b'x')
//   .iter().all(|&b| b != b'x')               → !strings::contains_char(s, b'x')
//   .iter().filter(|&&b| b == b'x').count()   → strings::count_char(s, b'x')
//   .split(|&b| b == b'x')                    → strings::split(s, b"x")
//   .rsplit(|&b| b == b'x').next()            → &s[strings::last_index_of_char(s, b'x').map_or(0, |i| i + 1)..]
//   .splitn(2, |&b| b == b'x')                → strings::split_once_char(s, b'x')
//   .rsplitn(2, |&b| b == b'x')               → strings::rsplit_once_char(s, b'x')
//   .split_inclusive(|&b| b == b'x')          → strings::index_of_char_usize(s, b'x') in a loop
//
// Every slice method named `split*` or `rsplit*` is rejected when it is handed
// such a closure, with or without a row above.
//
// A comparand held in a variable (`|&b| b == sep`) or a predicate passed by
// name (`.split(is_separator)`) is invisible to this lint; use the `strings::`
// form anyway. A run scan (`.take_while(|&&b| b == b' ')`) is not matched
// either: `strings::index_of_not_char` finds the end of a leading run of one
// byte.
//
// Highway is also the only SIMD in the Rust sources. `std::simd` and the
// `core::arch` intrinsics are compiled for the baseline CPU, with no runtime
// dispatch, and would be a second set of kernels to keep correct on every
// target. clippy.toml bans `Simd`, `Mask` and their constructors, but a `u8x16`
// made with `.into()` gets past it. Nothing gets past the feature gate, so that
// is banned here. New kernels go in src/jsc/bindings/highway_strings.cpp or a
// highway_*.cpp beside it, with a wrapper in src/highway/lib.rs.

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
// The count that `splitn` / `rsplitn` take before the closure.
const COUNT = String.raw`(?:[^,()|]+,\s*)?`;

// Every slice method named `split*` or `rsplit*`. No capturing group may stand
// before PARAM: USE reads the closure's name as `\1`.
const SPLIT_FAMILY = new RegExp(String.raw`\.(?:split|rsplit)\w*\(\s*${COUNT}${PARAM}${BODY_EQ}`, "g");
// What replaces each of them. `strings::split` and `strings::rsplit` take one
// byte sequence and split at every match, so a row names them only where the
// libcore method does the same.
const SPLIT_HINTS: Record<string, string> = {
  split: 'strings::split(s, b"x") / strings::split_any(s, b"xy")',
  rsplit:
    "&s[strings::last_index_of_char(s, b).map_or(0, |i| i + 1)..] for the last field" +
    ' (byte set: strings::last_index_of_any(s, b"xy")) / strings::rsplit(s, b"x") for every field of one byte',
  splitn: 'strings::split_once_char(s, b), nested for n > 2 (byte set: strings::index_of_any(s, b"xy"))',
  rsplitn: 'strings::rsplit_once_char(s, b), nested for n > 2 (byte set: strings::last_index_of_any(s, b"xy"))',
  split_inclusive:
    'strings::index_of_char_usize(s, b) in a loop (byte set: strings::index_of_any(s, b"xy"))' +
    " / strings::replace_owned to rewrite the delimiter",
};
const SPLIT_HINT_OTHER =
  "strings::index_of_char_usize(s, b) / strings::last_index_of_char(s, b)" +
  " (byte set: strings::index_of_any / strings::last_index_of_any), then slice";
const splitHint = (match: string) => SPLIT_HINTS[/^\.(\w+)\(/.exec(match)![1]] ?? SPLIT_HINT_OTHER;

const BANNED: { name: string; re: RegExp; hint: string | ((match: string) => string) }[] = [
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
    name: "<[u8]>::split*(|b| b == byte)",
    re: SPLIT_FAMILY,
    hint: splitHint,
  },
  {
    name: "portable SIMD",
    re: /\bportable_simd\b|\b(?:std|core)::simd\b/g,
    hint: "a highway kernel (bun_highway, bun_core::strings)",
  },
  {
    name: "SIMD intrinsics",
    re: /\b(?:std|core)::arch::(?:x86|x86_64|arm|aarch64)\b/g,
    hint: "a highway kernel (bun_highway, bun_core::strings)",
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
        const replacement = typeof hint === "string" ? hint : hint(m[0]);
        offenders.push(`${source}:${line}: ${name}: \`${m[0].replace(/\s+/g, " ")}\` → ${replacement}`);
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

test("every slice split method handed a byte-literal closure is reported, with its own replacement", () => {
  // Per report of `line`, the `strings::` helpers that its hint names.
  const reports = (line: string) =>
    Array.from(line.matchAll(SPLIT_FAMILY), m =>
      Array.from(splitHint(m[0]).matchAll(/strings::(\w+)/g), helper => helper[1]).join(" "),
    );
  const samples: Record<string, string[]> = {
    "s.split(|&b| b == b'/')": ["split split_any"],
    "s.rsplit(|&byte| byte == b'/')": ["last_index_of_char last_index_of_any rsplit"],
    [String.raw`name.rsplit(|&it| it == b'/' || it == b'\\')`]: ["last_index_of_char last_index_of_any rsplit"],
    "s.splitn(2, |&c| c == b'@')": ["split_once_char index_of_any"],
    "s.rsplitn(3, |&byte| byte == b':')": ["rsplit_once_char last_index_of_any"],
    [String.raw`s.split_inclusive(|b| matches!(*b, b'\n'))`]: ["index_of_char_usize index_of_any replace_owned"],
    // A method with no row in SPLIT_HINTS.
    "s.rsplit_mut(|b| *b == b'/')": ["index_of_char_usize last_index_of_char index_of_any last_index_of_any"],
    // Not a slice split with a byte-literal closure.
    "s.split_at(3)": [],
    "text.split(|c| c == '/')": [],
    "s.rsplit(|&b| b == sep)": [],
    'strings::rsplit(s, b"/")': [],
  };
  expect(Object.fromEntries(Object.keys(samples).map(line => [line, reports(line)]))).toEqual(samples);
});
