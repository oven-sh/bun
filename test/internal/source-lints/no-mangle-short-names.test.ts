// `#[no_mangle]` / `#[unsafe(no_mangle)]` exports a function under its bare
// Rust name as a global C symbol in libbun_rust.a, where a one- or two-letter
// name is a link-time collision hazard with any C/C++ object that defines the
// same name, and no_mangle exempts the function from Rust's unused-code
// analysis, so a dead one never gets flagged. This happened: TextEncoder.rs
// carried a duplicate of TextEncoder__encode16 exported as the bare symbol `c`
// through several dead-code sweeps before it was noticed.
//
// The shortest legitimate exports today are `main` and `zig_log`, so a
// <= 3 character threshold needs no allowlist. Macro-metavariable functions
// (`fn $name` inside macro_rules!) are skipped: their exported names are the
// idents spelled at the macro call sites.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// Candidate files come from one `git grep` (tracked files, working-tree
// contents), and each file is scanned with a single regex pass; per-line
// JS loops over the whole tree are too slow under debug+ASAN builds.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// A no_mangle attribute at the start of a line, then the first `fn <ident>`
// within the next 9 lines (more attributes, visibility, `unsafe extern "C"`
// may sit in between). Group 1 is that in-between span, group 2 the name.
const SITE = /^[ \t]*#\[(?:unsafe\()?no_mangle\)?\]((?:[^\n]*\n){0,9}?[^\n]*?)\bfn[ \t]+(\$?[A-Za-z_][A-Za-z0-9_]*)/gm;

function countLines(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

test("no_mangle functions have names longer than 3 characters", () => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "grep", "-l", "no_mangle", "--", "src"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git grep failed (exit ${r.exitCode}): ${r.stderr.toString()}`);
  }
  const files = r.stdout
    .toString()
    .split("\n")
    .filter(f => f.endsWith(".rs"));
  expect(files.length).toBeGreaterThan(0);

  const violations: string[] = [];
  for (const rel of files) {
    const content = readFileSync(path.join(root, rel), "utf8");
    for (const m of content.matchAll(SITE)) {
      const name = m[2];
      if (name.startsWith("$") || name.length > 3) continue;
      // A `static`/`const` item between the attribute and a later, unrelated
      // `fn` means the attribute belongs to the static (e.g. a no_mangle
      // static followed by an ordinary function). `const` on the fn's own
      // line is part of the signature (`pub const extern "C" fn`), so only
      // the lines before the fn's line count.
      const between = m[1];
      const beforeFnLine = between.slice(0, between.lastIndexOf("\n") + 1);
      if (/\b(?:static|const)\b/.test(beforeFnLine)) continue;
      const line = 1 + countLines(content.slice(0, m.index)) + countLines(m[0]);
      violations.push(`${rel}:${line}: #[no_mangle] fn ${name}`);
    }
  }
  expect(violations).toEqual([]);
});
