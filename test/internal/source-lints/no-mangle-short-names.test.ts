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
// idents spelled at the macro call sites. A raw identifier (`fn r#ab`) is
// measured without the `r#`, which is what the exported symbol omits.
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
// within the next 9 lines (more attributes, doc comments, visibility,
// `unsafe extern "C"` may sit in between). Group 1 is that in-between span,
// group 2 the name.
const SITE =
  /^[ \t]*#\[(?:unsafe\()?no_mangle\)?\]((?:[^\n]*\n){0,9}?[^\n]*?)\bfn[ \t]+(?:r#)?(\$?[A-Za-z_][A-Za-z0-9_]*)/gm;

function countLines(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

function scanFile(rel: string, source: string): string[] {
  // Blank out full-line comments so prose like "this fn is exported" in a doc
  // comment between the attribute and the signature cannot match as a
  // function name (newlines are kept, so line numbers stay accurate).
  const content = source.replace(/^[ \t]*\/\/.*$/gm, "");
  const violations: string[] = [];
  SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SITE.exec(content)) !== null) {
    // A `static`/`const` item between the attribute and a later `fn` means
    // the attribute belongs to the static, not the fn. Rescan from the line
    // after the attribute instead of from the end of the match, so a
    // no_mangle fn later in the window anchors on its own attribute. `const`
    // on the fn's own line is part of the signature (`pub const extern "C"
    // fn`), so only the lines before the fn's line count.
    const between = m[1];
    const beforeFnLine = between.slice(0, between.lastIndexOf("\n") + 1);
    if (/\b(?:static|const)\b/.test(beforeFnLine)) {
      const nl = m[0].indexOf("\n");
      SITE.lastIndex = m.index + (nl === -1 ? m[0].length : nl + 1);
      continue;
    }
    const name = m[2];
    if (name.startsWith("$") || name.length > 3) continue;
    const line = 1 + countLines(content.slice(0, m.index)) + countLines(m[0]);
    violations.push(`${rel}:${line}: #[no_mangle] fn ${name}`);
  }
  return violations;
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

  const violations = files.flatMap(rel => scanFile(rel, readFileSync(path.join(root, rel), "utf8")));
  expect(violations).toEqual([]);
});

test("the matcher handles the tricky attribute arrangements", () => {
  const flag = (src: string) => scanFile("f.rs", src);

  // The motivating case, in both attribute spellings.
  expect(flag(`#[no_mangle]\npub extern "C" fn c() {}`)).toEqual(["f.rs:2: #[no_mangle] fn c"]);
  expect(flag(`#[unsafe(no_mangle)]\nunsafe extern "C" fn ab() {}`)).toEqual(["f.rs:2: #[no_mangle] fn ab"]);

  // Prose in a doc comment between the attribute and the signature is not a
  // function name.
  expect(flag(`#[unsafe(no_mangle)]\n/// This fn is exported for C callers.\nextern "C" fn Mod__fine() {}`)).toEqual(
    [],
  );

  // A no_mangle static does not suppress a short no_mangle fn right after it,
  // and is not itself a violation (nor is the ordinary fn following it).
  expect(flag(`#[unsafe(no_mangle)]\nstatic X: u32 = 1;\n\n#[unsafe(no_mangle)]\nextern "C" fn ab() {}`)).toEqual([
    "f.rs:5: #[no_mangle] fn ab",
  ]);
  expect(flag(`#[unsafe(no_mangle)]\nstatic X: u32 = 1;\n\nfn ab() {}`)).toEqual([]);

  // Raw identifiers export the symbol without `r#`; macro metavariables get
  // their names from the call sites.
  expect(flag(`#[no_mangle]\nextern "C" fn r#ab() {}`)).toEqual(["f.rs:2: #[no_mangle] fn ab"]);
  expect(flag(`#[no_mangle]\nextern "C" fn r#match() {}`)).toEqual([]);
  expect(flag(`#[no_mangle]\npub extern "C" fn $name() {}`)).toEqual([]);
});
