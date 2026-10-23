import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `&str` built with `core::str::from_utf8_unchecked` over a struct's own
// bytes (`from_utf8_unchecked(&self.buf)`, `from_utf8_unchecked(self.0)`) is
// sound only while nothing outside the defining module can choose those bytes.
// A `pub` field breaks that: a struct literal in safe code, in any crate, puts
// arbitrary bytes behind the cast, and the SAFETY comment on it no longer
// describes the program. A `&str` that is not UTF-8 is undefined behavior.
//
// Motivating instances, both in bun_core. `PrettyBuf(pub Vec<u8>)` in
// src/bun_core/output.rs backed `AsRef<str>` and `Display` with that cast, and
// also accepted a `&[u8]` template through `PrettyFmtInput`. `Raw<'a>(pub &'a
// [u8])` in src/bun_core/fmt.rs (the `fmt::s()` adapter) did the same in
// `Display`, over argv, paths and package.json strings.
//
// Scope: the cast and the struct definition have to be in the same file. A
// public constructor that accepts bytes defeats the invariant the same way and
// is not something this scan can see; review those by hand.
//
// Sibling guards: unsound-erased-box.test.ts, unsafe-refcount-exports.test.ts.

// Known offenders that a PR in flight removes. Keyed by source path, listing
// the struct names. Drop an entry once the fix lands.
const ALLOWED: Record<string, string[]> = {
  // `Raw::fmt` validates and substitutes U+FFFD in #37422.
  "src/bun_core/fmt.rs": ["Raw"],
};

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

// `from_utf8_unchecked(&self.buf)`, `(&mut self.buf[..n])`, `(self.0)`. The
// `\b(?!\s*\()` keeps `self.as_bytes()` (a method, not a field) out.
const CAST = /\bfrom_utf8_unchecked(?:_mut)?\(\s*&?\s*(?:mut\s+)?self\.(\w+)\b(?!\s*\()/g;

// An `impl` header, possibly spanning lines, up to its opening brace.
const IMPL_HEADER = /^impl\b[^{]*\{/gm;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

// Skip a balanced `<...>` group at the start of `s`.
function skipGenerics(s: string): string {
  if (!s.startsWith("<")) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "<") depth++;
    else if (s[i] === ">" && --depth === 0) return s.slice(i + 1);
  }
  return "";
}

// `impl<..> Trait<..> for Type<..> {` -> `Type`; `impl<..> Type<..> {` -> `Type`.
function implTarget(header: string): string | null {
  const rest = skipGenerics(header.replace(/^impl\b/, "").trimStart());
  const forIndex = rest.lastIndexOf(" for ");
  const target = forIndex >= 0 ? rest.slice(forIndex + " for ".length) : rest;
  const m = target.match(/^\s*&?(?:'\w+\s+)?(?:mut\s+)?(?:[\w]+::)*(\w+)/);
  return m ? m[1] : null;
}

// Index of the delimiter that closes the one at `open` (`(`/`)` or `{`/`}`).
function closing(text: string, open: number): number {
  const openCh = text[open];
  const closeCh = openCh === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

// Split on commas that are not nested in `<>`, `()` or `[]`.
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

// The `pub` qualifier (any form) on `field` of `struct name` in `text`, null if
// the field is private, undefined if the struct or field is not in `text`.
function fieldVisibility(text: string, name: string, field: string): string | null | undefined {
  const def = new RegExp(`\\bstruct\\s+${name}\\b[^;{(]*([({;])`).exec(text);
  if (def === null) return undefined;
  const open = def.index + def[0].length - 1;
  if (def[1] === ";") return undefined;
  const end = closing(text, open);
  if (end < 0) return undefined;
  const body = text.slice(open + 1, end);
  if (def[1] === "(") {
    const item = splitTopLevel(body)[Number(field)];
    if (item === undefined) return undefined;
    const vis = /^\s*(?:#\[[^\]]*\]\s*)*(pub(?:\([^)]*\))?)\s/.exec(item);
    return vis ? vis[1] : null;
  }
  const m = new RegExp(`(?:^|[{,])\\s*(?:#\\[[^\\]]*\\]\\s*)*(?:(pub(?:\\([^)]*\\))?)\\s+)?${field}\\s*:`).exec(body);
  if (m === null) return undefined;
  return m[1] ?? null;
}

const found: string[] = [];
const unresolved: string[] = [];
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
  // Strip full-line comments (including `///` docs) so prose mentions don't
  // count. `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay
  // right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const headers = [...stripped.matchAll(IMPL_HEADER)];
  for (const cast of stripped.matchAll(CAST)) {
    const line = lineOf(stripped, cast.index);
    const header = headers.filter(h => h.index < cast.index).at(-1);
    const type = header ? implTarget(header[0]) : null;
    if (type === null) {
      unresolved.push(`${source}:${line}: self.${cast[1]} outside an impl block`);
      continue;
    }
    const vis = fieldVisibility(stripped, type, cast[1]);
    if (vis === undefined) {
      unresolved.push(`${source}:${line}: struct ${type} or its field ${cast[1]} is not in this file`);
      continue;
    }
    found.push(`${source}:${line}: ${type}.${cast[1]}`);
    if (vis !== null && !ALLOWED[source]?.includes(type)) {
      offenders.push(`${source}:${line}: ${type}.${cast[1]} is ${vis}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern still recognizes the tree's own-bytes casts", () => {
  // If this goes empty, the casts moved into helpers this scan cannot follow
  // and the regex above needs updating, not the assertion below.
  expect(found).not.toBeEmpty();
});

test("every cast resolves to a struct in the same file", () => {
  // A cast whose struct lives elsewhere is outside what this lint can check.
  // Move the cast next to the struct, or extend the scan.
  expect(unresolved).toEqual([]);
});

test("a struct that casts its own bytes to str keeps that field private", () => {
  expect(offenders).toEqual([]);
});
