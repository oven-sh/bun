import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// ninja runs the `regen` edge of build.ninja (emitGeneratorRule in scripts/build/configure.ts) from the build
// directory, which `--build-dir` can put outside the checkout. A configure that reads process.cwd() therefore
// writes different paths into build.ninja than `bun bd` did, or fails to find the checkout at all (#45226).
// Every path configure derives starts from `repoRoot` (scripts/build/config.ts) or from cfg.buildDir.
//
// The sites listed here shorten a path for display only. A new site is a deliberate edit of this map.
const displayOnly: Record<string, number> = {
  "scripts/build.ts": 1,
  "scripts/build/annotations.ts": 1,
  "scripts/build/ci.ts": 1,
  "scripts/build/timings.ts": 2,
};

/** A line of a comment: `//` or a JSDoc line. Strings are not stripped, so a glob such as "deps/*.ts" is no comment. */
const commentLine = /^\s*(\/\/|\/\*|\*)/;

test("the build scripts do not derive paths from process.cwd()", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const files = ["scripts/build.ts"];
  for await (const rel of new Glob("**/*.ts").scan({ cwd: path.join(repoRoot, "scripts", "build") })) {
    files.push(path.join("scripts", "build", rel).replaceAll("\\", "/"));
  }
  expect(files.length).toBeGreaterThan(10);

  const found: Record<string, number> = {};
  for (const file of files.sort()) {
    let count = 0;
    for (const line of readFileSync(path.join(repoRoot, file), "utf8").split("\n")) {
      if (commentLine.test(line)) continue;
      count += line.match(/\bprocess\.cwd\(\)/g)?.length ?? 0;
    }
    if (count > 0) found[file] = count;
  }
  expect(found).toEqual(displayOnly);
});
