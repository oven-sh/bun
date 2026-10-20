import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A CSS property handler buffers one value for a set of vendor prefixes. lightningcss flushes the buffer only when
// the set lacks the prefix of the next declaration (`val != cur && !prefixes.contains(vp)`), so a declaration of one
// name replaces the value of the other buffered names: `-ms-x: a; x: a; -ms-x: b` prints `x: b`.
//
//   !prefixes.contains(vp)  → prefixes.must_flush_before(vp, || <the flush derives the prefixes from the targets>)
//
// The lint sees the test by its argument: the prefix of a declaration is a variable, and every other `contains` on a
// set of prefixes names a constant (`VendorPrefix::NONE`). It does not see a rule that is written in another way.
const banned = /(?:&&\s*!\s*|\|\|\s*)[\w$]+(?:\s*\.\s*[\w$]+)*\s*\.contains\(\s*\*?\s*\$?[a-z_]\w*(?:\.\w+)*\s*,?\s*\)/;

// border-radius keeps the test until its store adds the prefix to the set (#45665).
const allowed = new Set(["src/css/properties/border_radius.rs"]);

test("the ban matches the flush test of lightningcss and no other use of contains", () => {
  for (const line of [
    "if cur != val && !prefixes.contains(*vp) {",
    "if !(field.0 == *$val) && !field.1.contains(*$vp) {",
    "!SmallList::eql(&bxs.0, box_shadows) && !bxs.1.contains(prefix)",
    "if val == cur || prefixes.contains(*prefix) {",
  ]) {
    expect(line).toMatch(banned);
  }
  for (const line of [
    "if prefix.contains(VendorPrefix::NONE) && !border_image.slice.fill {",
    "&& !(incoming.contains(VendorPrefix::NONE) && flush_derives_prefixes()))",
    "current.1.must_flush_before(vp, || context.targets.derives_prefixes())",
  ]) {
    expect(line).not.toMatch(banned);
  }
});

test("css property handlers decide a flush with VendorPrefix::must_flush_before", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const directory = "src/css/properties";
  const found: string[] = [];
  let scanned = 0;
  for await (const rel of new Glob("*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
    const file = `${directory}/${rel}`;
    scanned++;
    if (allowed.has(file)) continue;
    readFileSync(path.join(repoRoot, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (!/^\s*\/\//.test(line) && banned.test(line)) found.push(`${file}:${index + 1}`);
      });
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(20);
  expect(found).toEqual([]);
});
