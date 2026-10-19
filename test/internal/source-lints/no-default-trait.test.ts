import { file } from "bun";
import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The Rust sources do not use `core::default::Default`.
//
// A derived `Default` gives every field zero, `false`, `None` or empty, and nothing in the source says
// so. `..Default::default()` at a construction site hides the fields it fills. A type with `Default` and
// a real constructor can be made in two ways, and the two drift apart: `Log::default()` ignored the
// configured log level, and `StackCheck::default()` made a guard that never stopped a recursion.
//
// What to write:
//   - an enum: name the variant.
//   - a struct: an inherent constructor (`new()`, `init()`) that spells every field, and
//     `..Foo::new()` at a site that sets only some of them.
//   - `mem::take(&mut x)` of such a type: `mem::replace(&mut x, Foo::new())`.
//   - generic code: take the value from the caller, or use a const of the trait that bounds the type
//     (`bun_core::Integer::ZERO`, `bun_alloc::Stateless::INSTANCE`).
//
// clippy.toml bans the derive, the calls and the bounds with the compiler's view of the types
// (`disallowed-macros`, `disallowed-methods`, `disallowed-types`). That is not enough: clippy lints one
// target, a few crates and modules switch those lints off for other reasons (bun_core, bun_alloc, bun_sys),
// and none of the three lints sees a hand-written `impl Default for`. This file closes those gaps by text.
//
// A call `Foo::default()` is reported unless `Foo` has a function of that name of its own in these sources
// (the CSS value types do). Otherwise it can only be the trait, on a type of std or of another crate.

// file -> lines that may stay, each with its reason.
const ALLOWED: Record<string, { line: RegExp; why: string }[]> = {
  "src/parsers/benches/xml_parse.rs": [
    {
      line: /^\s*\.\.Default::default\(\)$/,
      why: "roxmltree::ParsingOptions is a type of another crate with no other constructor",
    },
  ],
  "src/parsers/benches/json_parse.rs": [
    { line: /\bCriterion::default\(\)/, why: "criterion::Criterion has no other constructor" },
  ],
  "src/runtime/api/html_rewriter.rs": [
    {
      line: /^\s*lol_html::(?:Element|Document)ContentHandlers::default\(\);$/,
      why: "lol_html gives these types no other constructor",
    },
  ],
  "src/runtime/crypto/CryptoHasher.rs": [
    { line: /^\s*<\$ty>::default\(\)$/, why: "RustCrypto gives a hash state no other constructor" },
  ],
};

// Types of other crates whose `default()` is a function of their own, not the trait.
const OWN_DEFAULT_ELSEWHERE = new Set(["FxHasher"]);

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray `.rs` files in the working
// tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// Comments, string literals, and the char literal of a double quote (it would open a string).
const NOT_CODE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'\\?"'|\b[bc]?r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"/g;

/** Blanks everything that is not code, and keeps every newline, so an offset still gives a line. */
const codeOnly = (source: string) => source.replace(NOT_CODE, m => m.replace(/[^\n]/g, " "));

const PATTERNS: [name: string, re: RegExp][] = [
  // `#[derive(.., Default, ..)]`, also inside `cfg_attr`. A derive list has no `)` in it.
  ["#[derive(Default)]", /\bderive\s*\([^)]*\bDefault\b[^)]*\)/g],
  // `impl Default for X`, `impl<T> ::core::default::Default for X<T>`.
  ["impl Default for", /\bimpl\b(?:\s*<[^{};]*?>)?\s+(?:::)?(?:(?:core|std)::default::)?Default\s+for\b/g],
  // The trait named in a call or as a function value: `Default::default()`, `.map_or_else(Default::default, ..)`.
  ["Default::default", /(?<![A-Za-z0-9_:])(?:(?:::)?(?:core|std)::default::)?Default::default\b/g],
  // A bound: `T: Default`, `+ Default`, `impl Default`, `dyn Default`, `<T as Default>`. `Kind::Default` is an enum variant.
  [
    "a Default bound",
    /(?:(?<!:):(?!:)|\+|\bimpl\b|\bdyn\b|\bas\b)\s*(?:(?:::)?(?:core|std)::default::)?Default\b(?!\s*(?:::|for\b))/g,
  ],
];

// `impl .. Foo<..> {` and `impl .. Trait for Foo<..> {`: the indentation and the name of the type.
const IMPL =
  /^([ \t]*)(?:unsafe\s+)?impl\b(?:\s*<[^{};]*?>)?\s+(?:[^{};]*?\bfor\s+)?(?:[A-Za-z_][A-Za-z0-9_]*::)*(\$?[A-Za-z_][A-Za-z0-9_]*)[^{};]*\{/gm;
const FN_DEFAULT = /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?fn\s+default\b/gm;
// `Foo::default(`, `Foo::<T>::default(`, and `<X as Y>::default(` (no name).
const CALL = /(?:\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:::\s*<[^;{}()]*?>\s*)?|>\s*)::\s*default\s*\(/g;

const sources: { source: string; text: string; code: string | null }[] = [];
// The types that have a `default` function of their own.
const ownDefault = new Set(["Self", ...OWN_DEFAULT_ELSEWHERE]);
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; scan each file once under its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const text = await file(abs).text();
  scanned++;
  // Most files have no match at all, also not in a comment. Only the others pay for the mask.
  if (!text.includes("default") && !text.includes("Default")) continue;
  const code =
    text.search(FN_DEFAULT) >= 0 || text.search(CALL) >= 0 || PATTERNS.some(([, re]) => text.search(re) >= 0)
      ? codeOnly(text)
      : null;
  sources.push({ source, text, code });
  if (code === null) continue;
  const impls = [...code.matchAll(IMPL)];
  for (const fn of code.matchAll(FN_DEFAULT)) {
    const around = impls.findLast(it => it.index < fn.index && it[1].length < fn[1].length);
    if (around) ownDefault.add(around[2]);
  }
}

const found: string[] = [];
for (const { source, text, code } of sources) {
  if (code === null) continue;
  const lines = text.split("\n");
  const allowed = ALLOWED[source] ?? [];
  const report = (name: string, index: number) => {
    const lineNo = code.slice(0, index).split("\n").length;
    const line = lines[lineNo - 1];
    if (!allowed.some(a => a.line.test(line))) found.push(`${source}:${lineNo}: ${name}: ${line.trim()}`);
  };
  for (const [name, re] of PATTERNS) {
    for (const m of code.matchAll(re)) report(name, m.index);
  }
  for (const m of code.matchAll(CALL)) {
    if (m[1] === undefined || !ownDefault.has(m[1])) report("a call of Default::default", m.index);
  }
}

test("scans the tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(1000);
});

test("no Rust source derives, implements, names or requires `Default`", () => {
  expect(found).toEqual([]);
});

test("every allowed line still exists", () => {
  const stale: string[] = [];
  for (const [source, entries] of Object.entries(ALLOWED)) {
    const lines = readFileSync(path.join(root, source), "utf8").split("\n");
    for (const entry of entries) {
      if (!lines.some(line => entry.line.test(line))) stale.push(`${source}: ${entry.line}`);
    }
  }
  expect(stale).toEqual([]);
});
