import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The CSS parser folds math functions and converts colors, and it prints the results. `f32::sin`, `f32::atan2`,
// `f32::powf`, `f32::cbrt` and the others in `banned` are the functions of the C library, which differ in the last
// bit between glibc, musl, Apple's libm and the Windows CRT. One stylesheet then builds to different bytes on each
// of them.
//
// Call `crate::values::math` instead. It gives the same bits on every host. `sqrt`, `abs`, `floor`, `round`, `%` and
// `powi` do not depend on the host, so they are not banned.
test("the CSS crates do not call the float functions of the C library", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const names =
    "sin|cos|tan|asin|acos|atan|atan2|sin_cos|sinh|cosh|tanh|exp|exp2|exp_m1|ln|ln_1p|log|log2|log10|powf|hypot|cbrt";
  // `x.sin()` and `f32::sin(x)`.
  const banned = new RegExp(`\\.(?:${names})\\s*\\(|\\bf(?:32|64)::(?:${names})\\b`);
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
