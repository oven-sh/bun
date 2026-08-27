import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `if true { .. }` and `if false { .. }` never belong in shipped Rust.
//
// rustc type-checks both sides of a literal condition and reports nothing:
// `dead_code` does not look inside function bodies, `unreachable_code` only
// fires after a diverging expression, and clippy has no lint for a bare
// literal condition. So an `if false` body is dead code that still has to
// compile (it pins imports, labels and fields that nothing else needs), and an
// `if true` body is an always-taken block with one extra level of indentation.
// Both are leftovers of the Zig port, where `if (comptime false)` was the
// idiom for disabling a block.
//
// Delete an `if false` body. Unwrap an `if true` body. A block that must stay
// compilable but never run belongs in a `#[cfg(test)]` compile-only test, which
// this lint skips.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// frozen-nonnull-reborrow.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// A statement-position `if` whose whole condition is a bool literal, with or
// without a leading `} else`. `if x == true {` and `if cfg!(..) {` do not match.
const LITERAL_CONDITION = /^\s*(?:\}\s*else\s+)?if\s+(?:true|false)\s*\{/;

/**
 * Blank out every `#[cfg(test)]`-gated item (the attribute line, any attributes
 * after it, and the braced item they annotate) so compile-only unit tests can
 * keep their `if false { .. }` bodies. Line numbers are preserved.
 */
function withoutTestItems(lines: string[]): string[] {
  const out = [...lines];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*#\[cfg\(test\)\]/.test(lines[i])) {
      i++;
      continue;
    }
    // Blank the attribute lines and the item they annotate. The item may share
    // the attribute's line (`#[cfg(test)] use ..;`); a braced item ends when its
    // braces balance, a one-line item (`use ..;`, `mod tests;`) at its `;`.
    let depth = 0;
    let sawBrace = false;
    while (i < lines.length) {
      const line = lines[i].replace(/^\s*(?:#\[[^\]]*\]\s*)+/, "");
      out[i++] = "";
      if (line.trim() === "") continue;
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          sawBrace = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (sawBrace ? depth <= 0 : line.includes(";")) break;
    }
  }
  return out;
}

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
  // don't count. `[ \t]*`, not `\s*`: the latter would swallow the blank lines
  // before a comment and shift every line number after them.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const lines = withoutTestItems(stripped.split("\n"));
  for (const [index, line] of lines.entries()) {
    if (LITERAL_CONDITION.test(line)) offenders.push(`${source}:${index + 1}: ${line.trim()}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing (e.g. a
  // symlinked checkout root) and leaving nothing to scan, which would make the
  // ban below pass vacuously. Same guard as unsound-erased-box.test.ts.
  expect(scanned).toBeGreaterThan(0);
});

test("withoutTestItems keeps production code and blanks #[cfg(test)] items", () => {
  const kept = withoutTestItems([
    "fn live() {",
    "    if false {",
    "    }",
    "}",
    "#[cfg(test)]",
    "mod tests {",
    "    #[test]",
    "    fn compile_only() {",
    "        if false {",
    "        }",
    "    }",
    "}",
    "#[cfg(test)]",
    "use std::fmt;",
    "fn also_live() {}",
    "#[cfg(test)] mod tests;",
    "fn live_too() {}",
    "#[cfg(test)] #[allow(unused)] fn compile_only() { if false {} }",
    "fn last() {}",
  ]);
  expect(kept).toEqual([
    "fn live() {",
    "    if false {",
    "    }",
    "}",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "fn also_live() {}",
    "",
    "fn live_too() {}",
    "",
    "fn last() {}",
  ]);
});

test("if true { .. } / if false { .. } outside #[cfg(test)] code", () => {
  expect(offenders).toEqual([]);
});
