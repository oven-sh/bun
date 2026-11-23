import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The printer and the linker's chunk generation read ASTs that other threads
// are reading at the same time: the bundler prints a module into every chunk
// that includes it, in parallel, from one AST. An in-place rope flatten there
// (`E::String::resolve_rope_if_needed`, or anything built on it) writes `data`
// and `next = None` into the shared node while the other printers read it.
// The observed results were the tail printed twice, the tail dropped, and a
// crash on a torn `next` pointer (`Bus error at address 0x56700000000`).
//
// `StoreRef<T>` is `Copy` and implements `DerefMut`, so `let mut e = *e;
// e.resolve_rope_if_needed(bump)` compiles and silently mutates the arena node.
// The read-only form is `e.flattened(bump)`, which returns a local copy with the
// rope flattened into `bump`. The `&mut self` rope methods are for the parser,
// which owns its nodes.
//
//   x.resolve_rope_if_needed(bump)   → let x = x.flattened(bump);
//   x.slice(bump)                    → x.flattened(bump).string(bump)
//   x.is_identifier(bump)            → is_identifier(x.flattened(bump).slice8())
//   x.to_utf8(bump)                  → x.flattened(bump).string(bump)
//   e_string_mut()                   → e_string() (a `StoreRef`, read it only)

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Code that runs on the shared, post-parse AST with other threads.
const SCOPE = ["src/js_printer/", "src/bundler/linker_context/", "src/bundler/LinkerContext.rs"];

const rustSources = globAllSources().rust.filter(abs => {
  if (!abs.endsWith(".rs")) return false;
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  return SCOPE.some(s => (s.endsWith("/") ? rel.startsWith(s) : rel === s));
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

const BANNED: { name: string; re: RegExp; hint: string }[] = [
  {
    name: "E::String::resolve_rope_if_needed",
    re: /\.resolve_rope_if_needed\(/g,
    hint: "flattened(bump)",
  },
  {
    // The `E::String` method takes the arena; `StoreSlice::slice()` and the
    // other no-argument `slice()` accessors do not match.
    name: "E::String::slice(bump)",
    re: /\.slice\(\s*[A-Za-z_][\w.:]*\s*\)/g,
    hint: "flattened(bump).string(bump)",
  },
  {
    // Method form with an argument; the free fn `js_lexer::is_identifier(x)`
    // has no leading `.`.
    name: "E::String::is_identifier(bump)",
    re: /\.is_identifier\(\s*[A-Za-z_]/g,
    hint: "is_identifier(flattened(bump).slice8())",
  },
  {
    // `bun_core::String::to_utf8()` takes no argument and is fine.
    name: "E::String::to_utf8(bump)",
    re: /\.to_utf8\(\s*[A-Za-z_]/g,
    hint: "flattened(bump).string(bump)",
  },
  {
    name: "ExprData::e_string_mut",
    re: /\.e_string_mut\(/g,
    hint: "e_string() and read through the StoreRef",
  },
];

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions do not count. `[ \t]*`, not
  // `\s*`, so the newline before a comment survives and line numbers hold.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re, hint } of BANNED) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        offenders.push(`${source}:${i + 1}: ${name} (use ${hint}): ${lines[i].trim()}`);
      }
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("the printer and linker never flatten a string rope in place", () => {
  expect(offenders).toEqual([]);
});
