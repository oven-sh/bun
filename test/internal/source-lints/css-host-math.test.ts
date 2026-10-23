import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The CSS parser folds math functions and converts colors, and it prints the results. `f32::asin`, `f32::acos`,
// `f32::atan`, `f32::atan2`, `f32::hypot`, `f32::cbrt`, `f32::ln` and `f32::log` call the C library. Its result
// differs in the last bit between glibc, musl, Apple's libm and the C runtime that Bun links on Windows. One
// stylesheet then builds to different bytes on each of them.
//
// Call `crate::values::math` instead. It gives the same bits on every host.
test("the CSS crates do not call asin, acos, atan, atan2, hypot, cbrt, ln or log of the C library", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const names = "asin|acos|atan|atan2|hypot|cbrt|ln|log";
  // `x.atan2(y)`, and `f32::atan2(x, y)` through any path but `math::`.
  const banned = new RegExp(`\\.(?:${names})\\s*\\(|(?<!\\bmath)::(?:${names})\\b`);
  const allowed = "src/css/values/math.rs";

  const found: string[] = [];
  let scanned = 0;
  for (const dir of ["src/css", "src/css_jsc", "src/css_derive"]) {
    for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, dir) })) {
      const file = path.join(dir, rel).replaceAll("\\", "/");
      if (file === allowed) continue;
      scanned++;
      const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/^\s*\/\//.test(line) && banned.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(50);
  expect(found).toEqual([]);
});
