import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { listTrackedRsFiles, planEdits, stripLongComments } from "../../scripts/strip-long-rs-comments";

const repoRoot = path.resolve(import.meta.dir, "../..");

test("stripLongComments: top-of-file block, threshold, HOST_EXPORT markers", () => {
  const input = [
    "//! top-of-file block line 1",
    "//! top-of-file block line 2",
    "//! top-of-file block line 3",
    "//! top-of-file block line 4",
    "//! top-of-file block line 5",
    "",
    "use core::mem;",
    "",
    "// three-line block: stays",
    "// three-line block: stays",
    "// three-line block: stays",
    "pub fn kept_short() {}",
    "",
    "// four-line block: goes",
    "// four-line block: goes",
    "// four-line block: goes",
    "// four-line block: goes",
    "pub fn stripped_above() {}",
    "",
    "/// doc line 1",
    "/// doc line 2",
    "/// doc line 3",
    "// HOST_EXPORT(Bun__keepMe, c)",
    "pub fn host_exported() {}",
    "",
    "impl Foo {",
    "    // indented block line 1",
    "    // indented block line 2",
    "    // indented block line 3",
    "    // indented block line 4",
    "    // indented block line 5",
    "    fn bar() {}",
    "}",
    "",
  ].join("\n");

  const expected = [
    "//! top-of-file block line 1",
    "//! top-of-file block line 2",
    "//! top-of-file block line 3",
    "//! top-of-file block line 4",
    "//! top-of-file block line 5",
    "",
    "use core::mem;",
    "",
    "// three-line block: stays",
    "// three-line block: stays",
    "// three-line block: stays",
    "pub fn kept_short() {}",
    "",
    "pub fn stripped_above() {}",
    "",
    "// HOST_EXPORT(Bun__keepMe, c)",
    "pub fn host_exported() {}",
    "",
    "impl Foo {",
    "    fn bar() {}",
    "}",
    "",
  ].join("\n");

  const got = stripLongComments(input);
  expect(got).toBe(expected);
  // Idempotent.
  expect(stripLongComments(got)).toBe(got);
});

test("stripLongComments: leaves short blocks and trailing comments alone", () => {
  const src = [
    "fn main() {",
    "    let x = 1; // trailing comment, untouched",
    "    // one",
    "    // two",
    "    // three",
    "    let y = 2;",
    "}",
    "",
  ].join("\n");
  expect(stripLongComments(src)).toBe(src);
});

test("stripLongComments: SAFETY blocks are kept in full", () => {
  const src = [
    "use a;",
    "",
    "// SAFETY: this is the first line of a long justification.",
    "// It continues onto a second line,",
    "// a third line,",
    "// a fourth line,",
    "// and a fifth line.",
    "unsafe { do_thing() };",
    "",
    "/// # Safety",
    "/// Caller must ensure `p` is valid.",
    "/// Really valid.",
    "/// Extremely valid.",
    "pub unsafe fn external(p: *const u8) {}",
    "",
    "// Safety: clippy matches the marker case-insensitively, so a mixed-case",
    "// justification is load-bearing too.",
    "// It continues onto a third line,",
    "// and a fourth line.",
    "unsafe { do_other_thing() };",
    "",
  ].join("\n");
  expect(stripLongComments(src)).toBe(src);
});

test("stripLongComments: adjacent long blocks separated by a blank collapse cleanly", () => {
  const src = [
    "use a;",
    "",
    "// section banner 1",
    "// section banner 2",
    "// section banner 3",
    "// section banner 4",
    "",
    "/// doc 1",
    "/// doc 2",
    "/// doc 3",
    "/// doc 4",
    "pub fn f() {}",
    "",
  ].join("\n");
  const expected = ["use a;", "", "pub fn f() {}", ""].join("\n");
  expect(stripLongComments(src)).toBe(expected);
});

test("tree is clean: no .rs file has a strippable >3-line comment block", async () => {
  // Running the stripper over every file it would touch should find nothing to
  // remove. Fails on a tree where scripts/strip-long-rs-comments.ts has not
  // been applied; passes once it has.
  const files = await listTrackedRsFiles(repoRoot);
  expect(files.length).toBeGreaterThan(100);

  // 4+ consecutive lines whose only content (modulo leading space/tab) is a
  // `//` comment. Operates on the whole source at once so the per-line work is
  // done by the native regex engine instead of the debug-build JS interpreter.
  const blockRe = /(?:^[ \t]*\/\/[^\n]*\n){4,}/gm;
  // Fast-path mirrors PROTECTED_BLOCK in the script (two regexes so the
  // `Safety:` marker alternative can be case-insensitive on its own).
  const protectedBlockRe = /\bSAFETY\b|^[ \t]*\/\/\/[ \t]*#+[ \t]*Safety\b/m;
  const safetyMarkerRe = /^[ \t]*\/\/[/!]*[ \t]*safety[ \t]*:/im;

  const offenders: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    // Offset of the first non-blank character → start of the top-of-file block.
    let fc = 0;
    while (fc < src.length) {
      const c = src.charCodeAt(fc);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      fc++;
    }
    blockRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(src))) {
      if (m.index === fc) continue; // top-of-file header — allowed
      if (protectedBlockRe.test(m[0]) || safetyMarkerRe.test(m[0])) continue; // SAFETY / Safety: / # Safety — allowed
      // Defer to the real planner for anything else (HOST_EXPORT markers etc).
      const edits = planEdits(src.split("\n"), 4);
      if (edits.length === 0) break;
      offenders.push(`${rel}:${edits[0].start + 1}`);
      break;
    }
    if (offenders.length >= 20) break;
  }

  expect(offenders).toEqual([]);
});
